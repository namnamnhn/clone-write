import { useState, useRef, useEffect } from 'react';
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../services/api/gemini';
import { CreativeState, CreativeChapter, Character, CreativeSnapshot, LogContext } from '../../types';

// Giữ tối đa 20 snapshot gần nhất (mỗi lượt "Viết Tiếp" chụp 1 bản trước khi áp dụng chương mới)
// — đủ dùng để lùi lại vài lượt gần đây, tránh phình state/localStorage vô hạn với truyện viết
// hàng trăm lượt.
const CREATIVE_SNAPSHOT_LIMIT = 20;
import { parseEpub, downloadTextFile } from '../../utils/fileHelpers';

// Đọc ngược đúng định dạng do handleExportSetup xuất ra ("ThietLapSangTac_*.txt") - dùng cho
// tính năng "Nhập Thiết Lập" mới. Hàm thuần, không side-effect; trả về null nếu không nhận diện
// được nội dung (không tìm thấy nhãn mục [..] nào) để nơi gọi báo lỗi rõ ràng cho người dùng.
interface ParsedSetupFile {
    seedTitle: string; genre: string; premise: string; worldNotes: string; charNotes: string; outline: string;
    characters: Character[];
}
const parseCharacterBlock = (block: string): Character | null => {
    const lines = block.split('\n');
    const header = (lines[0] || '').trim();
    // Khớp đúng cấu trúc dòng đầu do handleExportSetup sinh ra:
    // "- Tên (Vai trò), Giới tính, Tuổi tuổi" (các phần role/gender/age đều tùy chọn)
    const m = header.match(/^-\s*([^(,]+?)\s*(?:\(([^)]*)\))?\s*(?:,\s*(.+))?$/);
    if (!m || !m[1]?.trim()) return null;
    const name = m[1].trim();
    const role = (m[2] || '').trim();
    let gender = '';
    let age = '';
    if (m[3]) {
        for (const part of m[3].split(',').map(s => s.trim()).filter(Boolean)) {
            const ageMatch = part.match(/^(\d+)\s*tuổi$/);
            if (ageMatch) age = ageMatch[1];
            else if (!gender) gender = part;
        }
    }
    let appearance = '';
    let personality = '';
    for (const line of lines.slice(1)) {
        const t = line.trim();
        if (t.startsWith('Ngoại hình:')) appearance = t.replace('Ngoại hình:', '').trim();
        else if (t.startsWith('Tính cách:')) personality = t.replace('Tính cách:', '').trim();
    }
    return {
        id: 'char_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name, role, gender, age,
        appearance: appearance === '(chưa có)' ? '' : appearance,
        personality: personality === '(chưa có)' ? '' : personality,
    };
};
const PLACEHOLDER_VALUES = new Set(['(Chưa chọn)', '(Chưa có)', '(Chưa có nhân vật nào)', '(Chưa đặt tên)']);
export const parseSetupFile = (text: string): ParsedSetupFile | null => {
    if (!text || !text.includes('[')) return null;
    const titleMatch = text.match(/^THIẾT LẬP SÁNG TÁC:\s*(.*)$/m);
    const seedTitle = titleMatch && !PLACEHOLDER_VALUES.has(titleMatch[1].trim()) ? titleMatch[1].trim() : '';

    const getSection = (label: string): string => {
        const re = new RegExp(`\\[${label}\\]\\n([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`);
        const m = text.match(re);
        if (!m) return '';
        const val = m[1].trim();
        return PLACEHOLDER_VALUES.has(val) ? '' : val;
    };

    const genre = getSection('THỂ LOẠI');
    const premise = getSection('TIỀN ĐỀ / TÓM TẮT');
    const worldNotes = getSection('THẾ GIỚI');
    const charSection = getSection('NHÂN VẬT');
    const charNotes = getSection('GHI CHÚ NHÂN VẬT KHÁC');
    const outline = getSection('DÀN Ý');

    if (!seedTitle && !genre && !premise && !worldNotes && !charSection && !charNotes && !outline) return null;

    const characters = charSection
        ? charSection.split(/\n\n+/).map(b => b.trim()).filter(Boolean).map(parseCharacterBlock).filter((c): c is Character => !!c)
        : [];

    return { seedTitle, genre, premise, worldNotes, charNotes, outline, characters };
};

export interface UseCreativePageProps {
    addToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
    state: CreativeState;
    setState: React.Dispatch<React.SetStateAction<CreativeState>>;
    setStoryInfoSafe?: (info: any) => void;
    storyInfo?: any;
    files?: any[];
    setFilesSafe?: (action: React.SetStateAction<any[]>) => void;
    setCoverImage?: (file: File | null) => void;
    setStartTime?: (v: number | null) => void;
    setEndTime?: (v: number | null) => void;
    addLog?: (msg: string, type?: 'success' | 'error' | 'info', context?: LogContext) => void;
}

// Extracted from CreativePage.tsx (step 4 refactor): holds all state + AI/handler
// logic for the Creative writing wizard. The component itself now only renders,
// using the values/handlers returned here. Logic kept 100% identical to original.
export const useCreativePage = ({
    addToast, state, setState, setStoryInfoSafe, storyInfo, files, setFilesSafe, setCoverImage, setStartTime, setEndTime, addLog
}: UseCreativePageProps) => {
    const [currentStep, setCurrentStep] = useState(1);
    const [mode, setMode] = useState<'new' | 'continue'>('new');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [userPrompt, setUserPrompt] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    // NEW: input riêng cho tính năng "Nhập Thiết Lập" (đối xứng với "Xuất Thiết Lập" đã có sẵn -
    // trước đây chỉ xuất được, không có chiều nhập ngược lại file .txt đã xuất).
    const setupFileInputRef = useRef<HTMLInputElement>(null);
    const chaptersEndRef = useRef<HTMLDivElement>(null);
    
    const [isGenerating, setIsGenerating] = useState(false);
    // Tạm Ngừng khi đang sáng tác (yêu cầu người dùng — trước đây không có cách nào hủy 1 lần gọi
    // đang chạy, chỉ có thể chờ hoặc đóng tab). generateContent hỗ trợ abortSignal ở config; lưu ý
    // đây là 1 lần gọi duy nhất (không streaming) nên hủy giữa chừng sẽ MẤT toàn bộ nội dung của
    // lượt đang viết dở (không có gì để parse ra), không phải "dừng và giữ lại phần đã viết" — đã
    // nêu rõ trong toast/log khi dừng để người dùng hiểu đúng, tránh hiểu nhầm là mất dữ liệu do lỗi.
    const abortControllerRef = useRef<AbortController | null>(null);
    const handleStopGenerating = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    const [editingCharId, setEditingCharId] = useState<string | null>(null);
    const [charForm, setCharForm] = useState<Partial<Character>>({});

    const handleSaveChar = () => {
        if (!charForm.name) {
            addToast('Tên nhân vật không được để trống!', 'warning');
            return;
        }
        setState(prev => {
            const characters = prev.characters || [];
            if (editingCharId) {
                return { ...prev, characters: characters.map(c => c.id === editingCharId ? { ...c, ...charForm } as Character : c) };
            } else {
                return { ...prev, characters: [...characters, { ...charForm, id: 'char_' + Date.now() } as Character] };
            }
        });
        setEditingCharId(null);
        setCharForm({});
    };

    const handleEditChar = (c: Character) => {
        setEditingCharId(c.id);
        setCharForm(c);
    };

    const handleDeleteChar = (id: string) => {
        if (confirm('Bạn có chắc muốn xóa nhân vật này?')) {
            setState(prev => ({ ...prev, characters: (prev.characters || []).filter(c => c.id !== id) }));
        }
    };

    const setup = state?.setup || {};
    const setSetup = (patch: any) => setState(prev => ({ ...prev, setup: { ...(prev?.setup || {}), ...patch } }));

    const seedTitle = setup.seedTitle || '';
    const premise = setup.premise || '';
    const worldNotes = setup.worldNotes || '';
    const charNotes = setup.charNotes || '';
    const outline = setup.outline || '';
    const genre = setup.genre || 'Tiên Hiệp';

    useEffect(() => {
        if (state?.chapters?.length > 0 && currentStep === 5) {
            chaptersEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [state?.chapters, currentStep]);

    const handleAnalyzeNew = async () => {
        if (!userPrompt.trim()) {
            addToast('Vui lòng nhập ý tưởng của bạn!', 'error');
            return;
        }
        setIsAnalyzing(true);
        addLog?.('Bắt đầu phân tích ý tưởng (3.5 Flash)...', 'info');
        try {
            const ai = getAiClient();
            const res = await smartExecution(
                ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.0-flash'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: `Bạn là chuyên gia thiết kế cốt truyện tiên hiệp/đô thị/khoa huyễn. 
Dựa vào ý tưởng sau của người dùng: "${userPrompt}"
Hãy phát triển và điền vào các mục sau. Trả về đúng định dạng JSON, không có code block markdown:
{
  "title": "Tên truyện đề xuất",
  "genre": "Thể loại chính (Tiên Hiệp, Huyền Huyễn, Đô Thị...)",
  "premise": "Tóm tắt ý tưởng cốt truyện (Premise)",
  "worldNotes": "Bối cảnh thế giới/Hệ thống tu luyện",
  "charNotes": "Ghi chú nhân vật chung",
  "characters": [
    { "name": "Tên", "gender": "Nam/Nữ", "age": "Tuổi", "role": "Vai trò", "appearance": "Ngoại hình", "personality": "Tính cách" }
  ],
  "outline": "Dàn ý cơ bản (Từ khởi đầu đến đỉnh cao)"
}`,
                        config: { safetySettings: SAFETY_SETTINGS, temperature: 0.7 }
                    });
                    return r.text || '';
                },
                'Phân tích ý tưởng mới', (msg, context) => addLog?.(msg, 'info', context)
            );

            const jsonStr = res.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(jsonStr);

            setSetup({
                seedTitle: data.title || '',
                genre: data.genre || genre,
                premise: data.premise || '',
                worldNotes: data.worldNotes || '',
                charNotes: data.charNotes || '',
                outline: data.outline || ''
            });

            if (data.characters && Array.isArray(data.characters)) {
                setState(prev => ({
                    ...prev,
                    characters: data.characters.map((c: any) => ({ ...c, id: 'char_' + Date.now() + '_' + Math.random() }))
                }));
            }

            if (setStoryInfoSafe && storyInfo) {
                setStoryInfoSafe({ ...storyInfo, title: data.title || storyInfo.title });
            }

            addToast('Phân tích thành công! Đã tự động điền các trang thiết lập.', 'success');
            setCurrentStep(2); // Auto advance to next step
        } catch (e: any) {
            addToast('Lỗi phân tích: ' + e.message, 'error');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleEpubUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsAnalyzing(true);
        addLog?.('Bắt đầu đọc và phân tích EPUB (3.5 Flash)...', 'info');
        try {
            const parsed = await parseEpub(file);
            if (setFilesSafe && parsed.files.length > 0) {
                const mappedFiles = parsed.files.map(f => ({ ...f, translatedContent: f.content, status: 'completed' as any }));
                setFilesSafe(mappedFiles);
            }
            if (setCoverImage && parsed.coverBlob) {
                const ext = parsed.coverBlob.type.split('/')[1] || 'jpg';
                setCoverImage(new File([parsed.coverBlob], `cover.${ext}`, { type: parsed.coverBlob.type }));
            }
            if (setStoryInfoSafe && storyInfo) {
                setStoryInfoSafe({ ...storyInfo, title: parsed.info.title || storyInfo.title, author: parsed.info.author || storyInfo.author });
            }

            const textContent = parsed.files.map(f => f.content).join('\n\n').substring(0, 100000);

            const ai = getAiClient();
            const response = await smartExecution(
                ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.0-flash'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: `Bạn là biên tập văn học. Đọc nội dung truyện sau. Hãy tóm tắt và trích xuất thông tin để chuẩn bị viết tiếp.
Trả về định dạng JSON (không có markdown):
{
  "genre": "Thể loại theo đánh giá của bạn (Tiên hiệp, kỳ ảo, hiện đại...)",
  "premise": "Tóm tắt mạch truyện tới thời điểm hiện tại.",
  "worldNotes": "Hệ thống tu luyện, bối cảnh thế giới hiện có.",
  "charNotes": "Ghi chú nhân vật chung",
  "characters": [
    { "name": "Tên", "gender": "Nam/Nữ", "age": "Tuổi", "role": "Vai trò", "appearance": "Ngoại hình", "personality": "Tính cách" }
  ],
  "outline": "Dàn ý dự kiến cho các chương tiếp theo để viết tiếp."
}

Nội dung:
${textContent}`,
                        config: { safetySettings: SAFETY_SETTINGS, temperature: 0.5 }
                    });
                    return r.text || '';
                },
                'Phân tích EPUB', (msg, context) => addLog?.(msg, 'info', context)
            );

            const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(jsonStr);

            setSetup({
                seedTitle: parsed.info.title || '',
                genre: data.genre || genre,
                premise: data.premise || '',
                worldNotes: data.worldNotes || '',
                charNotes: data.charNotes || '',
                outline: data.outline || ''
            });

            if (data.characters && Array.isArray(data.characters)) {
                setState(prev => ({
                    ...prev,
                    characters: data.characters.map((c: any) => ({ ...c, id: 'char_' + Date.now() + '_' + Math.random() }))
                }));
            }

            addToast('Nhập dữ liệu và phân tích thành công!', 'success');
            setCurrentStep(2);
        } catch (error: any) {
            addToast('Lỗi xử lý file EPUB: ' + error.message, 'error');
            addLog?.('Lỗi EPUB: ' + error.message, 'error');
        } finally {
            setIsAnalyzing(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleGenerateCreativeChapters = async () => {
        setIsGenerating(true);
        if (setStartTime) setStartTime(Date.now());
        // FIX (yêu cầu người dùng): trước đây chỉ có đúng 1 model 'gemini-3.1-pro-preview', không
        // có model dự phòng — 3.1 Pro lỗi/quá tải là sáng tác fail thẳng, không tự chuyển sang
        // model khác như bên dịch (bên dịch đã có sẵn cơ chế fallback qua smartExecution). Nay
        // Giữ 3.1 Pro làm chính; Flash mới nhất chỉ đứng đầu chuỗi dự phòng.
        addLog?.('Bắt đầu sáng tác liên hoàn (ưu tiên Gemini 3.1 Pro, dự phòng 3.8 / 3.7 / 3.6 Flash, Max 65536 tokens)...', 'info');

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const ai = getAiClient();
            const systemInst = `Bạn là đại tác giả viết truyện chuyên nghiệp.
Hãy viết THẬT DÀI, BỨT PHÁ GIỚI HẠN. Lần này bạn được yêu cầu viết liên tiếp ${state.targetChapters || 10} chương (tận dụng tối đa 65536 tokens output).

[CẤU TRÚC PHÂN CHƯƠNG - CRITICAL]
Bạn PHẢI BẮT BUỘC tách mỗi chương ra một thẻ <CHAPTER> riêng biệt. TUYỆT ĐỐI KHÔNG ĐƯỢC gộp chung nội dung nhiều chương vào cùng một thẻ <CHAPTER>.
Cấu trúc output NGHIÊM NGẶT mỗi chương phải bọc trong thẻ XML sau:

<CHAPTER title="Chương (số): (Tên chương)">
Nội dung chi tiết của duy nhất chương này ở đây...
</CHAPTER>

Lặp lại cấu trúc trên cho TỪNG CHƯƠNG.

[NHÂN VẬT MỚI]
Nếu trong quá trình viết có sự xuất hiện của nhân vật mới (chưa có trong danh sách Nhân vật đã biết), bạn hãy CHỦ ĐỘNG liệt kê nhân vật đó ở cuối response (sau khi đóng tất cả thẻ CHAPTER) bằng thẻ sau:
<NEW_CHARACTER name="..." gender="..." age="..." role="..." appearance="..." personality="..." />

[TÓM TẮT TRUYỆN - BẮT BUỘC, CRITICAL CHO TÍNH LIỀN MẠCH]
Sau khi đóng TẤT CẢ thẻ CHAPTER và các thẻ NEW_CHARACTER (nếu có), bạn BẮT BUỘC phải viết 1 thẻ <STORY_SUMMARY> duy nhất ở cuối cùng, chứa bản tóm tắt TOÀN BỘ câu chuyện tính đến hết chương vừa viết xong (không chỉ tóm tắt riêng các chương vừa viết — phải gộp cả những gì đã xảy ra trước đó dựa trên "Tóm tắt hiện tại" + "Nội dung đã có" được cung cấp bên dưới). Đây là bản tóm tắt sẽ được dùng thay thế hoàn toàn cho "Tóm tắt hiện tại" ở lần viết tiếp theo, nên PHẢI đầy đủ diễn biến chính, không bỏ sót các nút thắt/mối quan hệ/vật phẩm/sức mạnh quan trọng đã xuất hiện, kể cả những chương từ rất lâu ngoài phạm vi "Nội dung đã có" hiện tại. Viết súc tích, mạch lạc, theo thứ tự thời gian.
<STORY_SUMMARY>
Bản tóm tắt đầy đủ toàn bộ câu chuyện tính đến hiện tại ở đây...
</STORY_SUMMARY>`;

            let pastContent = '';
            if (state.chapters && state.chapters.length > 0) {
                const recent = state.chapters.slice(-20);
                pastContent = recent.map(c => `[${c.title}]\n${c.content}`).join('\n\n');
            } else if (mode === 'continue' && files && files.length > 0) {
                const recentFiles = files.slice(-10);
                pastContent = recentFiles.map(f => `[${f.name}]\n${f.translatedContent || f.content}`).join('\n\n');
            }

            const prompt = `[THÔNG TIN TRUYỆN]
Tên truyện: ${seedTitle || storyInfo?.title}
Bối cảnh: ${worldNotes}
Nhân vật đã biết (Cấu trúc mới): ${JSON.stringify(state.characters || [])}
Ghi chú nhân vật (Khác): ${charNotes}
Dàn ý/Định hướng (CRITICAL: PHẢI BÁM SÁT DÀN Ý, TIẾN TRIỂN CỐT TRUYỆN THEO ĐÚNG DÀN Ý): 
${outline}

Tóm tắt hiện tại: ${premise}
Thể loại chính: ${genre}
Tổng số chương dự kiến: ${state.totalTargetChapters || 200} chương

[NỘI DUNG ĐÃ CÓ (Tham khảo)]
${pastContent || '(Chưa có nội dung, hãy viết bắt đầu từ Chương 1)'}

[YÊU CẦU]
Hãy viết TIẾP TỤC từ điểm dừng cuối cùng (nếu đã có), hoặc bắt đầu từ Chương 1.
Viết liên tục đúng ${state.targetChapters || 10} chương với chất lượng cao nhất.
Văn phong mượt mà, cuốn hút. Không tóm tắt nội dung để qua loa. Thiết lập các chi tiết, thoại, hành động đầy đủ. Hãy bám sát Dàn ý đã cho.
Đừng quên thẻ <STORY_SUMMARY> bắt buộc ở cuối cùng như hướng dẫn.`;

            const res = await smartExecution(
                ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: prompt,
                        config: { systemInstruction: systemInst, safetySettings: SAFETY_SETTINGS, temperature: 0.8, maxOutputTokens: 65536, abortSignal: controller.signal }
                    });
                    return r.text || '';
                },
                'Sáng tác nhiều chương', (msg, context) => addLog?.(msg, 'info', context)
            );

            // Parse chapters
            const chapterRegex = /<CHAPTER[^>]*title=["']?([^"'>]+)["']?[^>]*>([\s\S]*?)<\/CHAPTER>/gi;
            let match;
            const newChapters: CreativeChapter[] = [];
            
            while ((match = chapterRegex.exec(res)) !== null) {
                const title = match[1].trim();
                const content = match[2].trim();
                if (content) {
                    newChapters.push({
                        id: 'chap_' + Date.now() + '_' + Math.random(),
                        title,
                        content,
                        status: 'completed',
                        retryCount: 0
                    });
                }
            }

            // Parse new characters
            const charRegex = /<NEW_CHARACTER\s+([^>]+)\/?>/gi;
            let charMatch;
            const newChars: Character[] = [];
            while ((charMatch = charRegex.exec(res)) !== null) {
                const attrs = charMatch[1];
                const extractAttr = (name: string) => {
                    const m = new RegExp(`${name}=["']([^"']+)["']`, 'i').exec(attrs);
                    return m ? m[1] : '';
                };
                
                const name = extractAttr('name');
                if (name) {
                    newChars.push({
                        id: 'char_' + Date.now() + '_' + Math.random(),
                        name,
                        gender: extractAttr('gender'),
                        age: extractAttr('age'),
                        role: extractAttr('role'),
                        appearance: extractAttr('appearance'),
                        personality: extractAttr('personality')
                    });
                }
            }

            if (newChars.length > 0) {
                addLog?.(`Đã phát hiện và tự động ghi nhớ ${newChars.length} nhân vật mới.`, 'success');
            }

            // FIX (yêu cầu người dùng — đảm bảo liền mạch/logic khi sáng tác nhiều lượt): trước đây
            // "Tóm tắt hiện tại" (premise) chỉ lấy 1 lần lúc setup ban đầu, KHÔNG BAO GIỜ tự cập
            // nhật theo diễn biến mới — với truyện dài (vượt quá cửa sổ 20 chương gần nhất gửi kèm
            // mỗi lần), AI dần chỉ còn dựa vào tóm tắt đã lỗi thời, dễ quên/loạn diễn biến. Nay bắt
            // model tự trả về tóm tắt MỚI, ĐẦY ĐỦ (thẻ STORY_SUMMARY) sau mỗi lượt viết, và ghi đè
            // thẳng vào premise để lượt viết tiếp theo luôn có "trí nhớ" cập nhật, không cần thêm 1
            // lệnh gọi AI riêng để tóm tắt (đỡ tốn thêm quota/thời gian).
            const summaryMatch = /<STORY_SUMMARY>([\s\S]*?)<\/STORY_SUMMARY>/i.exec(res);
            if (summaryMatch && summaryMatch[1].trim()) {
                setSetup({ premise: summaryMatch[1].trim() });
                addLog?.('Đã tự động cập nhật tóm tắt truyện để giữ liền mạch cho lượt viết tiếp theo.', 'success');
            } else {
                addLog?.('Model không trả về thẻ STORY_SUMMARY lần này — tóm tắt truyện giữ nguyên như cũ, có thể cần bổ sung thủ công nếu truyện đã dài.', 'info');
            }

            // FIX (yêu cầu người dùng): chụp snapshot trạng thái NGAY TRƯỚC khi áp dụng lượt viết
            // này vào state — mỗi lượt "Viết Tiếp" đều là 1 lần gọi AI không hoàn hảo, có thể lạc
            // đề/sai văn phong/lặp ý mà người dùng chỉ nhận ra sau khi đọc xong. Trước đây không
            // có cách nào lùi lại ngoài xóa tay từng chương mới. Snapshot được chụp DÙ rơi vào
            // nhánh thành công hay nhánh fallback (auto parse) bên dưới, để luôn có điểm khôi phục
            // đúng ngay trước lượt vừa chạy.
            const snapshot: CreativeSnapshot = {
                id: 'snap_' + Date.now() + '_' + Math.random(),
                createdAt: Date.now(),
                chapterCountBefore: (state.chapters || []).length,
                chapters: state.chapters || [],
                characters: state.characters || [],
                premise: (summaryMatch && summaryMatch[1].trim()) ? premise : (state.setup?.premise || premise),
            };
            const pushSnapshot = (prevSnapshots?: CreativeSnapshot[]) =>
                [...(prevSnapshots || []), snapshot].slice(-CREATIVE_SNAPSHOT_LIMIT);

            if (newChapters.length > 0) {
                addToast(`Đã viết thành công ${newChapters.length} chương mới!`, 'success');
                setState(prev => ({
                    ...prev,
                    chapters: [...(prev.chapters || []), ...newChapters],
                    characters: [...(prev.characters || []), ...newChars],
                    snapshots: pushSnapshot(prev.snapshots)
                }));
            } else {
                addToast('Không tìm thấy thẻ <CHAPTER> hợp lệ, đang lưu toàn bộ text vào 1 chương bù.', 'warning');
                // Bỏ thẻ STORY_SUMMARY (nếu có) ra khỏi nội dung chương bù, tránh lẫn tóm tắt vào
                // nội dung truyện khi phải fallback lưu nguyên văn response.
                const resWithoutSummary = summaryMatch ? res.replace(summaryMatch[0], '').trim() : res.trim();
                setState(prev => ({
                    ...prev,
                    chapters: [...(prev.chapters || []), {
                        id: 'chap_' + Date.now(),
                        title: `Chương mới (Auto parse)`,
                        content: resWithoutSummary,
                        status: 'completed',
                        retryCount: 0
                    }],
                    characters: [...(prev.characters || []), ...newChars],
                    snapshots: pushSnapshot(prev.snapshots)
                }));
            }
        } catch (e: any) {
            // FIX (nút Tạm Ngừng): AbortController.abort() khiến generateContent reject với lỗi
            // dạng AbortError — hiển thị riêng, nhẹ nhàng hơn thay vì báo như 1 lỗi thật, vì đây là
            // hành động người dùng chủ động bấm dừng, không phải sự cố. Lưu ý (đã nói rõ ở log):
            // đây là 1 lần gọi duy nhất không streaming nên dừng giữa chừng = mất toàn bộ nội dung
            // lượt đang viết dở, không giữ lại được phần dở dang.
            const isAborted = e?.name === 'AbortError' || /abort/i.test(e?.message || '');
            if (isAborted) {
                addToast('Đã dừng sáng tác theo yêu cầu. Lượt đang viết dở không được lưu (không hỗ trợ giữ lại phần dở dang).', 'warning');
                addLog?.('Đã dừng sáng tác theo yêu cầu người dùng.', 'info');
            } else {
                addToast(`Lỗi sáng tác: ${e.message}`, 'error');
            }
        } finally {
            abortControllerRef.current = null;
            setIsGenerating(false);
            if (setEndTime) setEndTime(Date.now());
        }
    };


    // Xuất file thiết lập (các bước trước Sáng Tác: Ý tưởng/Thế giới/Nhân vật/Dàn ý) ra .txt để
    // người dùng lưu lại/backup thủ công - trước đây không có cách nào xuất phần này ra ngoài.
    const handleExportSetup = () => {
        const characters = state.characters || [];
        const charText = characters.length > 0
            ? characters.map(c => `- ${c.name}${c.role ? ` (${c.role})` : ''}${c.gender ? `, ${c.gender}` : ''}${c.age ? `, ${c.age} tuổi` : ''}\n  Ngoại hình: ${c.appearance || '(chưa có)'}\n  Tính cách: ${c.personality || '(chưa có)'}`).join('\n\n')
            : '(Chưa có nhân vật nào)';
        const content = [
            `THIẾT LẬP SÁNG TÁC: ${seedTitle || storyInfo?.title || '(Chưa đặt tên)'}`,
            `Xuất lúc: ${new Date().toLocaleString('vi-VN')}`,
            '='.repeat(60),
            '',
            `[THỂ LOẠI]\n${genre || '(Chưa chọn)'}`,
            '',
            `[TIỀN ĐỀ / TÓM TẮT]\n${premise || '(Chưa có)'}`,
            '',
            `[THẾ GIỚI]\n${worldNotes || '(Chưa có)'}`,
            '',
            `[NHÂN VẬT]\n${charText}`,
            '',
            `[GHI CHÚ NHÂN VẬT KHÁC]\n${charNotes || '(Chưa có)'}`,
            '',
            `[DÀN Ý]\n${outline || '(Chưa có)'}`,
        ].join('\n');
        const safeTitle = (seedTitle || storyInfo?.title || 'ThietLap').replace(/[\\/:*?"<>|]/g, '').trim() || 'ThietLap';
        downloadTextFile(`ThietLapSangTac_${safeTitle}.txt`, content);
        addToast('Đã xuất file thiết lập (.txt)', 'success');
    };

    // Tải xuống toàn bộ chương đã sáng tác ra 1 file .txt - trước đây không có nút nào để lưu lại,
    // nội dung chỉ tồn tại trong bộ nhớ trình duyệt (mất nếu xoá dữ liệu/đổi máy).
    const handleDownloadChapters = () => {
        const chapters = state.chapters || [];
        if (chapters.length === 0) {
            addToast('Chưa có chương nào để tải xuống.', 'warning');
            return;
        }
        const content = chapters.map(c => `${c.title}\n${'-'.repeat(40)}\n\n${c.content}`).join('\n\n\n');
        const safeTitle = (seedTitle || storyInfo?.title || 'SangTac').replace(/[\\/:*?"<>|]/g, '').trim() || 'SangTac';
        downloadTextFile(`${safeTitle}_${chapters.length}Chuong.txt`, content);
        addToast(`Đã tải xuống ${chapters.length} chương (.txt)`, 'success');
    };

    // Nhập ngược file thiết lập đã xuất trước đó (.txt từ handleExportSetup) - đối xứng với tính
    // năng xuất, để người dùng có thể backup/khôi phục hoặc chia sẻ thiết lập giữa các phiên làm
    // việc/máy khác nhau mà không cần gõ lại từ đầu.
    const handleImportSetup = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const text = String(ev.target?.result || '');
                const parsed = parseSetupFile(text);
                if (!parsed) {
                    addToast('Không đọc được nội dung file thiết lập (sai định dạng - hãy dùng đúng file đã xuất từ "Xuất Thiết Lập").', 'error');
                    return;
                }
                const hasExisting = !!(seedTitle || premise || worldNotes || charNotes || outline || (state.characters && state.characters.length > 0));
                if (hasExisting && !confirm('Đã có dữ liệu thiết lập hiện tại (Ý tưởng/Thế giới/Nhân vật/Dàn ý). Nhập file mới sẽ GHI ĐÈ toàn bộ. Bạn có chắc muốn tiếp tục?')) {
                    return;
                }
                setSetup({
                    seedTitle: parsed.seedTitle,
                    genre: parsed.genre || genre,
                    premise: parsed.premise,
                    worldNotes: parsed.worldNotes,
                    charNotes: parsed.charNotes,
                    outline: parsed.outline,
                });
                setState(prev => ({ ...prev, characters: parsed.characters }));
                addToast(`Đã nhập thiết lập thành công (${parsed.characters.length} nhân vật).`, 'success');
            } catch (err: any) {
                addToast(`Lỗi đọc file thiết lập: ${err.message || 'không xác định'}`, 'error');
            }
        };
        reader.onerror = () => addToast('Không đọc được file.', 'error');
        reader.readAsText(file, 'utf-8');
        e.target.value = ''; // reset để có thể chọn lại đúng file này lần sau nếu cần
    };

    // FIX (yêu cầu người dùng — khôi phục snapshot Sáng Tác): khôi phục lại đúng trạng thái
    // chapters/characters/premise đã chụp trước 1 lượt "Viết Tiếp" cụ thể. Xoá luôn các snapshot
    // CHỤP SAU snapshot được chọn (nếu có) vì chúng chụp trạng thái "tương lai" so với mốc vừa lùi
    // về — giữ lại sẽ gây nhầm lẫn khi hiện danh sách chọn khôi phục ở lượt sau.
    const handleRestoreSnapshot = (snapshotId: string) => {
        const snapshots = state.snapshots || [];
        const idx = snapshots.findIndex(s => s.id === snapshotId);
        if (idx === -1) return;
        const target = snapshots[idx];
        if (!confirm(`Khôi phục về thời điểm trước lượt viết này? Truyện sẽ quay lại còn ${target.chapterCountBefore} chương, mọi chương/tóm tắt viết SAU mốc này sẽ bị thay thế.`)) {
            return;
        }
        setState(prev => ({
            ...prev,
            chapters: target.chapters,
            characters: target.characters,
            snapshots: snapshots.slice(0, idx)
        }));
        setSetup({ premise: target.premise });
        addToast(`Đã khôi phục về mốc ${target.chapterCountBefore} chương.`, 'success');
    };

    return {
        currentStep, setCurrentStep,
        mode, setMode,
        isAnalyzing, setIsAnalyzing,
        userPrompt, setUserPrompt,
        fileInputRef, chaptersEndRef,
        setupFileInputRef,
        isGenerating, setIsGenerating, handleStopGenerating,
        editingCharId, setEditingCharId,
        charForm, setCharForm,
        handleSaveChar, handleEditChar, handleDeleteChar,
        setup, setSetup,
        seedTitle, premise, worldNotes, charNotes, outline, genre,
        handleAnalyzeNew, handleEpubUpload, handleGenerateCreativeChapters,
        handleExportSetup, handleDownloadChapters, handleImportSetup,
        handleRestoreSnapshot,
    };
};
