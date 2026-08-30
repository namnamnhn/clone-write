// Nhóm hàm: DỌN DẸP danh sách file (quét chương rác, xoá chương trùng lặp).
import { FileItem, FileStatus } from '../../types';
import { detectJunkChapter, buildBigramCounts, diceFromCounts, countForeignChars } from '../../utils/text';
import type { CoreApi, UIApi } from '../apiTypes';

// --- Quét TRÙNG GẦN ĐÚNG (fuzzy) ---
// handleRemoveDuplicates (bên dưới) chỉ bắt được trùng khớp TUYỆT ĐỐI (chữ ký 200 ký tự đầu +
// 100 ký tự cuối phải giống hệt nhau). Với raw truyện bị crawl 2 lần từ 2 nguồn/2 bản khác
// nhau, mỗi chương thường bị đổi vài từ (né kiểm duyệt/chống copy) nên KHÔNG khớp tuyệt đối,
// nhưng phần lớn nội dung vẫn giống nhau — cần so "giống bao nhiêu %" thay vì so khớp tuyệt đối.
//
// Test thực tế trên 1 bộ truyện bị lặp gấp đôi (do người dùng cung cấp, ~6.300 file / ~3.150
// chương thật):
// - Ngưỡng 30% giống nhau (hệ số Dice trên bigram ký tự) là AN TOÀN: so thử hàng trăm cặp
//   chương chắc chắn KHÔNG liên quan tới nhau thì độ giống cao nhất đo được chỉ ~15%, không có
//   tác giả nào tự nhiên viết 2 chương khác nhau mà giống nhau tới 30%.
// - NHƯNG bản trùng của 1 chương không phải lúc nào cũng nằm ngay sát chương đó: 2 nguồn crawl
//   có thể trôi lệch số thứ tự dần dần (do 1 nguồn thiếu/dư chương ở đâu đó), có lúc cách xa
//   tới 15-20 chương liền kề mới tìm thấy bản trùng thật — so với cửa sổ hẹp (vài chương) chỉ
//   bắt được ~13% số cặp trùng thật. Mở cửa sổ so sánh lên 40 chương liền TRƯỚC mỗi chương thì
//   bắt được ~95% số cặp trùng thật, vẫn chạy trong vài giây với truyện vài nghìn chương.
//
// Hàm này CHỈ CHỌN (không tự xoá) các chương nghi trùng để người dùng tự kiểm tra rồi xoá bằng
// nút "Xóa" — tránh xoá nhầm do fuzzy match luôn có rủi ro sai nhiều hơn so khớp tuyệt đối.
const FUZZY_DUP_THRESHOLD = 0.30;
const FUZZY_DUP_WINDOW = 40; // so với tối đa 40 chương liền TRƯỚC đó — xem giải thích ở trên về việc 2 nguồn crawl có thể trôi lệch dần, không phải lúc nào bản trùng cũng nằm ngay sát nhau
const FUZZY_DUP_MIN_LEN = 300; // chương quá ngắn không đưa vào so fuzzy, tránh nhận nhầm do nội dung placeholder ngắn tình cờ giống nhau
const FUZZY_DUP_COMPARE_LEN = 800; // chỉ so 800 ký tự đầu mỗi bên để giữ hiệu năng khi so với cửa sổ rộng — vẫn đủ đại diện, đã test không ảnh hưởng độ chính xác
const FUZZY_DUP_CHUNK_SIZE = 250; // số chương xử lý mỗi đợt trước khi nhường lại luồng chính (tránh treo UI khi truyện có hàng nghìn chương)

const normalizeForFuzzyCompare = (content: string): string => {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const withoutTitle = lines.length > 1 ? lines.slice(1).join('') : lines.join('');
    return withoutTitle.replace(/\s+/g, '').substring(0, FUZZY_DUP_COMPARE_LEN);
};

export const useFileCleanup = (core: CoreApi, ui: UIApi) => {
    const handleScanJunk = () => {
        if (ui.filterStatuses.has('selected') && ui.selectedFiles.size > 0) {
            ui.setSelectedFiles(new Set());
            ui.setFilterStatuses(new Set());
            ui.addToast("Đã hủy chế độ xem rác. Trở về danh sách đầy đủ.", 'info');
            return;
        }
        const junkIds = new Set<string>();
        core.files.forEach((f: FileItem) => { if (detectJunkChapter(f.name, f.content)) junkIds.add(f.id); });
        if (junkIds.size > 0) {
            ui.setSelectedFiles(junkIds);
            ui.setFilterStatuses(new Set(['selected']));
            ui.setCurrentPage(1);
            ui.addToast(`Đã tìm thấy ${junkIds.size} chương rác. (Nhấn lại nút này để bỏ chọn)`, 'warning');
        } else {
            ui.addToast("Không tìm thấy chương rác nào rõ ràng.", 'success');
        }
    };


    const handleScanFuzzyDuplicates = async () => {
        if (ui.filterStatuses.has('selected') && ui.selectedFiles.size > 0) {
            ui.setSelectedFiles(new Set());
            ui.setFilterStatuses(new Set());
            ui.addToast("Đã hủy chế độ xem trùng gần đúng. Trở về danh sách đầy đủ.", 'info');
            return;
        }
        const files = core.files as FileItem[];
        if (files.length === 0) {
            ui.addToast("Chưa có chương nào để quét.", "warning");
            return;
        }

        ui.setActionProgress({ current: 0, total: 100, message: "Đang dựng chữ ký nội dung..." });

        // Bước 1: dựng bigram-map cho mỗi chương ĐÚNG 1 LẦN (thay vì build lại ở mỗi lần so
        // sánh trong cửa sổ 40 chương bên dưới — nếu không sẽ chậm hơn nhiều lần).
        const norms: string[] = new Array(files.length);
        const maps: Map<string, number>[] = new Array(files.length);
        for (let i = 0; i < files.length; i += FUZZY_DUP_CHUNK_SIZE) {
            await new Promise(r => setTimeout(r, 0));
            const end = Math.min(i + FUZZY_DUP_CHUNK_SIZE, files.length);
            for (let k = i; k < end; k++) {
                const norm = normalizeForFuzzyCompare(files[k].content);
                norms[k] = norm;
                maps[k] = buildBigramCounts(norm);
            }
            ui.setActionProgress({ current: Math.round((end / files.length) * 50), total: 100, message: "Đang dựng chữ ký nội dung..." });
        }

        // Bước 2: so mỗi chương với tối đa FUZZY_DUP_WINDOW chương liền TRƯỚC nó.
        const suspectIds = new Set<string>();
        for (let i = 0; i < files.length; i += FUZZY_DUP_CHUNK_SIZE) {
            await new Promise(r => setTimeout(r, 0));
            const end = Math.min(i + FUZZY_DUP_CHUNK_SIZE, files.length);
            for (let k = i; k < end; k++) {
                if (norms[k].length < FUZZY_DUP_MIN_LEN) continue;
                for (let back = 1; back <= FUZZY_DUP_WINDOW; back++) {
                    const j = k - back;
                    if (j < 0) break;
                    if (suspectIds.has(files[j].id)) continue; // so với bản "gốc" gần nhất chưa bị đánh dấu nghi trùng, tránh so chồng chéo giữa 2 chương đều đã nghi trùng
                    if (norms[j].length < FUZZY_DUP_MIN_LEN) continue;
                    if (diceFromCounts(maps[k], norms[k].length, maps[j], norms[j].length) >= FUZZY_DUP_THRESHOLD) {
                        suspectIds.add(files[k].id); // giữ chương trước (j) làm bản gốc, chọn chương sau (k) để người dùng xem lại/xoá
                        break;
                    }
                }
            }
            ui.setActionProgress({ current: 50 + Math.round((end / files.length) * 50), total: 100, message: "Đang so sánh các chương gần nhau..." });
        }

        ui.setActionProgress(null);

        if (suspectIds.size > 0) {
            ui.setSelectedFiles(suspectIds);
            ui.setFilterStatuses(new Set(['selected']));
            ui.setCurrentPage(1);
            ui.addToast(`Đã tìm thấy ${suspectIds.size} chương nghi trùng gần đúng (giống ≥${Math.round(FUZZY_DUP_THRESHOLD * 100)}% so với 1 chương gần đó). Đã chọn sẵn — vui lòng tự kiểm tra rồi bấm nút "Xóa" để xoá, hoặc bỏ chọn nếu đó là chương thật. (Nhấn lại nút này để bỏ chọn)`, 'warning');
        } else {
            ui.addToast("Không tìm thấy chương nào nghi trùng gần đúng.", 'success');
        }
    };

    const handleRemoveDuplicates = (scope: 'all' | 'selected') => {
        const targetIds = scope === 'selected' ? ui.selectedFiles : new Set(core.files.map((f: FileItem) => f.id));
        if (targetIds.size === 0) {
            ui.addToast("Vui lòng chọn file để xử lý trùng lặp.", "warning");
            return;
        }

        let internalDupsFixed = 0;
        let duplicateFilesRemoved = 0;
        
        const seenContent = new Set<string>();
        const filesToKeep: FileItem[] = [];

        core.files.forEach((file: FileItem) => {
            let content = file.content;
            let isInternalDup = false;

            if (targetIds.has(file.id)) {
                // 1. Check internal duplication (content repeated twice)
                const trimmed = content.trim();
                const halfLen = Math.floor(trimmed.length / 2);
                
                if (halfLen > 50) {
                    // Try exact half first
                    const exactHalf1 = trimmed.substring(0, halfLen).trim();
                    const exactHalf2 = trimmed.substring(trimmed.length - halfLen).trim();
                    
                    if (exactHalf1 === exactHalf2) {
                        content = exactHalf1;
                        isInternalDup = true;
                        internalDupsFixed++;
                    } else {
                        // Try fuzzy half (sometimes there are extra spaces or newlines in the middle)
                        const prefix = trimmed.substring(0, 100);
                        if (prefix.length === 100) {
                            const secondIndex = trimmed.indexOf(prefix, 100);
                            if (secondIndex > 0 && secondIndex > trimmed.length * 0.4 && secondIndex < trimmed.length * 0.6) {
                                const part1 = trimmed.substring(0, secondIndex).trim();
                                const part2 = trimmed.substring(secondIndex).trim();
                                if (Math.abs(part1.length - part2.length) < 100 && part1.substring(0, 200) === part2.substring(0, 200) && part1.substring(part1.length - 100) === part2.substring(part2.length - 100)) {
                                    content = part1;
                                    isInternalDup = true;
                                    internalDupsFixed++;
                                }
                            }
                        }
                    }
                }
            }

            // 2. Check file-level duplication
            // Generate robust signature: skip first line (often title), remove whitespace
            const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const contentWithoutTitle = lines.length > 1 ? lines.slice(1).join('') : lines.join('');
            const normalizedContent = contentWithoutTitle.replace(/\s+/g, '');
            
            // Use first 200 and last 100 chars as signature to avoid minor differences at the end
            const signature = normalizedContent.length > 300 
                ? `${normalizedContent.substring(0, 200)}_${normalizedContent.substring(normalizedContent.length - 100)}`
                : normalizedContent;

            if (seenContent.has(signature)) {
                if (targetIds.has(file.id)) {
                    duplicateFilesRemoved++;
                    // Skip adding to filesToKeep
                } else {
                    // Not targeted for removal, keep it but it's already in seenContent
                    filesToKeep.push(file);
                }
            } else {
                seenContent.add(signature);
                if (isInternalDup) {
                    // FIX (2 lỗi của nhánh "lặp nội dung trong 1 file"):
                    // (1) remainingRawCharCount từng gán thẳng content.length (NGUYÊN VĂN độ dài)
                    //     thay vì countForeignChars — cùng lớp lỗi "badge Sót Raw" mà fix56 đã dọn
                    //     ở mọi nơi khác.
                    // (2) KHÔNG có guard trạng thái: file ĐÃ DỊCH XONG (COMPLETED, có bản dịch)
                    //     dính nửa trùng lặp trong raw cũng bị reset về IDLE + xoá translatedContent
                    //     — mất bản dịch tốt một cách âm thầm chỉ vì raw chứa đoạn lặp. File đã có
                    //     bản dịch thì GIỮ NGUYÊN để người dùng tự quyết; chỉ reset các file chưa
                    //     dịch (IDLE/ERROR không có bản dịch giữ lại).
                    const hasTranslationToLose = !!file.translatedContent && file.status === FileStatus.COMPLETED;
                    if (hasTranslationToLose) {
                        filesToKeep.push(file);
                    } else {
                        filesToKeep.push({
                            ...file,
                            content: content,
                            originalCharCount: content.length,
                            remainingRawCharCount: countForeignChars(content),
                            status: FileStatus.IDLE,
                            translatedContent: undefined,
                            errorMessage: undefined
                        });
                    }
                } else {
                    filesToKeep.push(file);
                }
            }
        });

        if (internalDupsFixed > 0 || duplicateFilesRemoved > 0) {
            core.setFiles(filesToKeep);
            ui.addToast(`Đã xử lý: Xóa ${duplicateFilesRemoved} file trùng, Sửa ${internalDupsFixed} file bị lặp nội dung.`, 'success');
            if (scope === 'selected') {
                ui.setSelectedFiles(new Set());
            }
        } else {
            ui.addToast(`Không phát hiện nội dung trùng lặp nào.`, 'info');
        }
    };


    return { handleScanJunk, handleRemoveDuplicates, handleScanFuzzyDuplicates };
};
