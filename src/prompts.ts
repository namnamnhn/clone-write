
import { BASE_TRANSLATION_IDENTITY, BASE_TRANSLATION_IDENTITY_PART_2, BASE_OUTPUT_FORMAT, METADATA_TEMPLATE, STYLE_GUIDES_TEMPLATE, SPECIFIC_RULES, GENRE_RULES_PRESETS, getSpecificRules } from './prompts/translation';
import { AUTO_ANALYZE_PROMPT, GLOSSARY_ANALYSIS_PROMPT, NAME_ANALYSIS_PROMPT, MERGE_CONTEXT_PROMPT, MERGE_GLOSSARY_PROMPT, getPronounModeOverride, getNumberUnitModeOverride } from './prompts/analysis';

// Re-export for Service usage
export { 
    AUTO_ANALYZE_PROMPT, 
    GLOSSARY_ANALYSIS_PROMPT, 
    NAME_ANALYSIS_PROMPT, 
    MERGE_CONTEXT_PROMPT, 
    MERGE_GLOSSARY_PROMPT,
    getPronounModeOverride,
    getNumberUnitModeOverride
};

// --- MAIN PROMPT CONSTRUCTION ---

// LƯU Ý QUAN TRỌNG: DEFAULT_PROMPT là prompt KHỞI TẠO của mọi phiên làm việc mới (xem
// useCoreState.ts: useState(DEFAULT_PROMPT)) — áp dụng ngay cả khi người dùng KHÔNG bấm
// "Reset Prompt" hay chạy "Tối Ưu Prompt". Trước đây hằng số này thiếu hẳn getSpecificRules()
// (mục 9-13 trong prompts/translation.ts) — tức là THIẾU mục 13 "QUY TẮC PHÂN BIỆT HỘI THOẠI
// VÀ NỘI TÂM" (quy định *nội tâm*/**hệ thống** dùng để đóng EPUB/DOCX in nghiêng/in đậm đúng
// chỗ) VÀ thiếu bullet "NHẤT QUÁN ĐƠN VỊ SỐ ĐẾM LỚN" trong mục 12 — trong khi generateBasePrompt()
// (dùng khi bấm Reset Prompt hoặc sau khi Tối Ưu Prompt) LẠI CÓ đủ 2 quy tắc này. Kết quả: người
// dùng mới/chưa từng bấm Reset hay chạy Tối Ưu Prompt sẽ dịch mà KHÔNG có 2 quy tắc quan trọng
// trên ngay từ chương đầu tiên — đây chính là nguyên nhân sâu xa gây lẫn lộn đơn vị số đếm và
// lạm dụng in nghiêng theo ngoặc kép mà người dùng phản ánh. Đã bổ sung getSpecificRules(true)
// để DEFAULT_PROMPT khớp đầy đủ nội dung với generateBasePrompt(), chỉ khác phần xưng hô theo
// thể loại (DEFAULT_PROMPT dùng preset ANCIENT tĩnh do chưa có storyInfo.genres lúc khởi tạo).
export const DEFAULT_PROMPT = `${BASE_TRANSLATION_IDENTITY}
${BASE_TRANSLATION_IDENTITY_PART_2}

${GENRE_RULES_PRESETS.ANCIENT}

${METADATA_TEMPLATE}

${STYLE_GUIDES_TEMPLATE}

${getSpecificRules(true)}

${SPECIFIC_RULES}

${BASE_OUTPUT_FORMAT}`;

export function generateBasePrompt(genres: string[] = [], settings: string[] = [], enableTitleFormatting: boolean = true): string {
    return `${BASE_TRANSLATION_IDENTITY}
${BASE_TRANSLATION_IDENTITY_PART_2}

${getPronounRules(genres, settings)}

${METADATA_TEMPLATE}

${STYLE_GUIDES_TEMPLATE}

${getSpecificRules(enableTitleFormatting)}

${SPECIFIC_RULES}

${BASE_OUTPUT_FORMAT}`;
}

export const USER_TRANSLATION_PROMPT_CONTENT = DEFAULT_PROMPT;

// --- DYNAMIC HELPERS ---

/**
 * Automatically selects the appropriate Genre Preset based on the input genres and settings.
 */
export function getPronounRules(genres: string[] = [], settings: string[] = []): string {
    const lowerGenres = (genres || []).map(g => g.toLowerCase());
    const lowerSettings = (settings || []).map(s => s.toLowerCase());
    const combined = [...lowerGenres, ...lowerSettings];
    const rules: string[] = [];

    const hasAncientSignal = combined.some(g => g.includes('tiên hiệp') || g.includes('kiếm hiệp') || g.includes('cổ đại') || g.includes('tu tiên') || g.includes('huyền huyễn') || g.includes('đông phương') || g.includes('trung cổ'));
    // FIX (lỗ hổng phát hiện khi rà soát prompt theo yêu cầu đánh giá cải thiện): "Mỹ thực", "Y
    // tế", "Sức khỏe", "Khoa học" (phi viễn tưởng) đều được liệt kê là thể loại hợp lệ trong
    // METADATA_TEMPLATE (mục III) nhưng TRƯỚC ĐÂY không có tín hiệu nhận diện riêng nào trong hàm
    // này — nếu truyện chỉ gắn đúng 1 trong các thể loại này (không kèm tín hiệu Cổ Trang/Hiện Đại
    // nào khác), sẽ rơi vào "Default fallback" bên dưới và bị áp NHẦM bộ xưng hô Cổ Trang (ta-
    // ngươi, phu quân-nương tử, tại hạ...) dù bối cảnh thực tế là hiện đại/chuyên nghiệp (VD: 1
    // truyện về đầu bếp hoặc bác sĩ ở bối cảnh đời thực). Các thể loại này về bản chất là bối cảnh
    // ĐỜI THỰC HIỆN ĐẠI nên gộp vào tín hiệu Hiện Đại thay vì để mặc định sai thành Cổ Trang.
    // Không gộp "Thơ ca" vào đây vì thơ ca không có bối cảnh thời đại cố định (có thể cổ phong
    // hoặc hiện đại tùy bài) — cố ép 1 chiều sẽ dễ sai hơn để mặc định.
    const hasModernSignal = combined.some(g => g.includes('đô thị') || g.includes('hiện đại') || g.includes('ngôn tình') || g.includes('hài hước') || g.includes('thanh xuân') || g.includes('80-90') || g.includes('thập niên') || g.includes('mỹ thực') || g.includes('y tế') || g.includes('sức khỏe') || g.includes('khoa học'));

    // ĐỀ XUẤT CẢI THIỆN (đã đánh giá ở fix17, triển khai theo yêu cầu): 3 tín hiệu riêng cho Y Tế/
    // Sức Khỏe, Mỹ Thực, Khoa Học để nạp thêm preset chuyên biệt (GENRE_RULES_PRESETS.MEDICAL/
    // CULINARY/SCIENCE, xem prompts/translation.ts) — BỔ SUNG thêm, không thay thế hasModernSignal
    // ở trên (vẫn giữ nguyên bộ xưng hô đời thường nền tảng MODERN, chỉ thêm lớp sắc thái riêng).
    const hasMedicalSignal = combined.some(g => g.includes('y tế') || g.includes('sức khỏe'));
    const hasCulinarySignal = combined.some(g => g.includes('mỹ thực'));
    const hasScienceSignal = combined.some(g => g.includes('khoa học'));

    // 1. Cổ Trang / Tiên Hiệp / Kiếm Hiệp
    if (hasAncientSignal) {
        rules.push(GENRE_RULES_PRESETS.ANCIENT);
    }

    // 2. Hiện Đại / Đô Thị / Ngôn Tình / 80-90
    if (hasModernSignal) {
         rules.push(GENRE_RULES_PRESETS.MODERN);
    }

    // 2b. Y Tế/Sức Khỏe, Mỹ Thực, Khoa Học — preset chuyên biệt BỔ SUNG thêm sau MODERN (xem chú
    // thích ở khai báo hasMedicalSignal/hasCulinarySignal/hasScienceSignal phía trên).
    if (hasMedicalSignal) {
        rules.push(GENRE_RULES_PRESETS.MEDICAL);
    }
    if (hasCulinarySignal) {
        rules.push(GENRE_RULES_PRESETS.CULINARY);
    }
    if (hasScienceSignal) {
        rules.push(GENRE_RULES_PRESETS.SCIENCE);
    }

    // 1b. HYBRID: truyện vừa có tín hiệu "đô thị/hiện đại" vừa có tín hiệu "tu tiên/tiên hiệp"
    // (VD: "Đô thị tu tiên", "Dị năng xuyên không về đô thị"). Nếu chỉ nạp MODERN, các quy tắc
    // "TUYỆT ĐỐI KHÔNG dùng ta-ngươi" sẽ ép sai nhân vật gốc tu luyện thành xưng hô đời thường,
    // đây chính là nguyên nhân bug "ta" bị đổi cứng thành "tôi". Khi cả 2 tín hiệu cùng xuất hiện,
    // bổ sung thêm hướng dẫn context-switching thay vì để 1 preset đè tuyệt đối lên preset kia.
    if (hasAncientSignal && hasModernSignal) {
        rules.push(`### V.HYBRID QUY TẮC XƯNG HÔ CHO THỂ LOẠI LAI (ĐÔ THỊ + TU TIÊN/TIÊN HIỆP)
   - Truyện này có cả yếu tố hiện đại/đô thị VÀ tu tiên/tiên hiệp. KHÔNG được chọn tuyệt đối 1 trong 2 bộ xưng hô ở trên cho toàn bộ truyện.
   - Bối cảnh/nhân vật gắn với thế giới tu luyện, tông môn, chiến đấu bằng pháp lực -> dùng xưng hô Cổ Trang (ta - ngươi, huynh - đệ...) như phần ANCIENT ở trên.
   - Bối cảnh/nhân vật gắn với đời sống đô thị hiện đại thông thường (gia đình, công sở, bạn bè ngoài đời) -> dùng xưng hô Hiện Đại (tôi - cậu, anh - em...) như phần MODERN ở trên.
   - Nếu MC vốn là người tu luyện/dị năng nhưng đang sống ở đô thị và nhất quán tự xưng "ta" như một nét tính cách xuyên suốt truyện, GIỮ NGUYÊN "ta" cho nhân vật đó kể cả khi đang ở bối cảnh đô thị, không tự ý đổi thành "tôi".`);
    }

    // 3. Võng Du / Game
    if (combined.some(g => g.includes('võng du') || g.includes('game') || g.includes('esport') || g.includes('hệ thống'))) {
        rules.push(GENRE_RULES_PRESETS.GAME);
    }

    // 4. Western / Fantasy / Phương Tây
    if (combined.some(g => g.includes('phương tây') || g.includes('fantasy') || g.includes('ma pháp') || g.includes('âu cổ') || g.includes('huyền bí') || g.includes('magic'))) {
        rules.push(GENRE_RULES_PRESETS.WESTERN);
    }

    // 5. Light Novel / Japan / Anime
    if (combined.some(g => g.includes('light novel') || g.includes('isekai') || g.includes('nhật') || g.includes('đồng nhân') || g.includes('anime'))) {
        rules.push(GENRE_RULES_PRESETS.JAPAN);
    }

    // 6. Mạt Thế / Khoa Huyễn
    if (combined.some(g => g.includes('mạt thế') || g.includes('khoa huyễn') || g.includes('zombie') || g.includes('quân sự') || g.includes('sci-fi') || g.includes('tương lai'))) {
        rules.push(GENRE_RULES_PRESETS.SCIFI);
    }

    // 7. Vô Hạn Lưu / Đa Bối Cảnh
    if (combined.some(g => g.includes('vô hạn lưu') || g.includes('xuyên nhanh') || g.includes('đa vũ trụ'))) {
        rules.push(GENRE_RULES_PRESETS.INFINITE_FLOW);
    }

    // Default fallback if nothing matches
    if (rules.length === 0) {
        rules.push(GENRE_RULES_PRESETS.ANCIENT); // Default to Ancient for safe sino-vietnamese
    }

    return rules.join('\n\n');
};

/**
 * Helper to replace variables in the template
 */
export function replacePromptVariables(template: string, info: any): string {
    if (!template) return "";
    let result = template;
    const val = (v: any) => {
        if (Array.isArray(v)) return v.join(', ');
        return v ? String(v) : 'Chưa rõ';
    };
    result = result.replace(/\{\{TITLE\}\}/g, val(info.title));
    result = result.replace(/\{\{AUTHOR\}\}/g, val(info.author));
    result = result.replace(/\{\{LANGUAGE\}\}/g, val(info.languages));
    result = result.replace(/\{\{GENRE\}\}/g, val(info.genres));
    result = result.replace(/\{\{PERSONALITY\}\}/g, val(info.mcPersonality));
    result = result.replace(/\{\{SETTING\}\}/g, val(info.worldSetting));
    result = result.replace(/\{\{FLOW\}\}/g, val(info.sectFlow));
    
    // Replace Target Audience if exists
    result = result.replace(/\{\{TARGET_AUDIENCE\}\}/g, "Độc giả Việt Nam");

    // Inject title formatting rule for old prompts if missing
    if (!result.includes("LOẠI BỎ TIỀN TỐ SỐ BÀI ĐĂNG") && result.includes("CHUẨN HÓA TIÊU ĐỀ")) {
        result = result.replace(
            "- **KHÔNG SỬA ĐỔI, THÊM THẮT TIÊU ĐỀ:**", 
            "- **LOẠI BỎ TIỀN TỐ SỐ BÀI ĐĂNG:** Nếu tiêu đề gốc có dính thêm số thứ tự bài đăng ở phía trước (VD: \"1149.第1147章\" hoặc \"596. 第594章\"), BẮT BUỘC bỏ số tiền tố đi và dịch theo đúng số chương thực sự phía sau (Dịch thành \"Chương 1147:\" hoặc \"Chương 594:\"). Tuyệt đối không dịch thành Chương 1149 hay Chương 596.\n  - **KHÔNG SỬA ĐỔI, THÊM THẮT TIÊU ĐỀ:**"
        );
    }

    return result;
};

// --- STORY CONTEXT BLOCK (dùng chung cho tab Sửa Lỗi Theo Yêu Cầu & tab Tìm Hán Việt) ---
// Gộp toàn bộ thông tin bộ truyện (thể loại, tính cách nhân vật chính, bối cảnh, lưu phái,
// tóm tắt, ngữ cảnh bổ sung, quy tắc bổ sung của toàn truyện) + từ điển riêng + prompt dịch
// đang dùng (nếu đã tối ưu) thành 1 khối text duy nhất, để chèn vào các prompt phân tích/quét
// lỗi ở 2 tab trên — giúp AI hiểu đúng bối cảnh bộ truyện thay vì chỉ dựa vào mỗi yêu cầu rời
// rạc của người dùng lúc đó. Hàm thuần, không side-effect; bỏ qua phần nào rỗng.
export function buildStoryContextBlock(storyInfo?: any, dictionary?: string, promptTemplate?: string): string {
    let block = '';

    if (storyInfo) {
        const lines: string[] = [];
        if (storyInfo.title) lines.push(`Tên truyện: ${storyInfo.title}`);
        if (storyInfo.author) lines.push(`Tác giả: ${storyInfo.author}`);
        const tags = [
            ...(storyInfo.genres || []),
            ...(storyInfo.worldSetting || []),
            ...(storyInfo.mcPersonality || []),
            ...(storyInfo.sectFlow || []),
        ].filter(Boolean).join(', ');
        if (tags) lines.push(`Thể loại / Bối cảnh / Tính cách nhân vật chính / Lưu phái: ${tags}`);
        if (storyInfo.summary) lines.push(`Tóm tắt cốt truyện: ${storyInfo.summary}`);
        if (storyInfo.contextNotes) lines.push(`Ngữ cảnh bổ sung: ${storyInfo.contextNotes}`);
        if (storyInfo.additionalRules) lines.push(`Quy tắc bổ sung (áp dụng toàn truyện): ${storyInfo.additionalRules}`);
        if (lines.length > 0) block += `[THÔNG TIN BỘ TRUYỆN]\n${lines.join('\n')}\n`;
    }

    if (dictionary && dictionary.trim()) {
        block += `\n[TỪ ĐIỂN RIÊNG CỦA TRUYỆN]\n${dictionary.trim()}\n`;
    }

    if (promptTemplate && promptTemplate.trim()) {
        block += `\n[PROMPT DỊCH ĐANG DÙNG CHO TRUYỆN NÀY — tham khảo văn phong/quy ước xưng hô/thuật ngữ đã thiết lập, KHÔNG cần tuân theo định dạng thẻ tag kỹ thuật bên trong]\n${promptTemplate.trim()}\n`;
    }

    return block;
};