
import { ModelQuota } from './types';

// Export everything from the new split files
export * from './prompts';
export * from './defaultDictionary';

// ============================================================================
// EDITION FLAGS (fix59): 1 cây nguồn build ra 3 bản đóng gói —
//   'full' : bản đầy đủ (6 Tháng / 1 Năm) — hành vi giữ nguyên 100% như trước.
//   'lite' : bản rút gọn — chỉ có chế độ Flash + Lite (bỏ Normal/Pro/Full vì dính
//            model Pro), thay mọi chức năng của 3.1 Pro bằng 3.7 Flash, khoá batch
//            config (3 tệp / latin 60k / raw 30k), ẩn prompt gốc, lấy mẫu phân tích
//            cố định đầu/giữa/cuối tối đa 200k ký tự, BẮT BUỘC API key Gemini cá
//            nhân (không dùng key nhúng), hạn sử dụng chỉ mở ngày 1-3 hàng tháng.
// Bản Lite được tạo bằng cách swap đúng 3 file edition (index.html,
// metadata.json, src/constants.ts) — giống hệt cơ chế 6Thang/1Nam hiện có, nên
// mọi chỗ khác trong code chỉ được rẽ nhánh qua IS_LITE bên dưới.
// ============================================================================
export type AppEdition = 'full' | 'lite';
export const APP_EDITION = 'full' as AppEdition;
export const IS_LITE: boolean = APP_EDITION === 'lite';

// Cấu hình khoá cứng của bản Lite (batch size / giới hạn ký tự mỗi batch dịch)
export const LITE_BATCH_CONFIG = {
    FILES_PER_BATCH: 3,
    LATIN_MAX_CHARS: 60000,
    COMPLEX_MAX_CHARS: 30000,
};

// FIX87: đồng bộ 600.000 ký tự/phần cho Phân Tích Sâu, Sửa Lỗi và Hán Việt ở cả Full lẫn Lite
// để giảm số request. Mọi nơi vẫn cắt theo ranh giới chương/đoạn qua helper dùng chung.
export const FULL_ANALYSIS_CHUNK_MAX_CHARS = 600000;
export const LITE_ANALYSIS_CHUNK_MAX_CHARS = 600000;
export const ANALYSIS_CHUNK_MAX_CHARS = IS_LITE
    ? LITE_ANALYSIS_CHUNK_MAX_CHARS
    : FULL_ANALYSIS_CHUNK_MAX_CHARS;

// FIX85: ngưỡng ký tự/chunk RIÊNG cho bước HỢP NHẤT NGỮ CẢNH (mergeContexts), KHÔNG dùng chung
// ANALYSIS_CHUNK_MAX_CHARS ở trên. Input Hợp Nhất đã là dữ liệu cô đọng và nhiệm vụ là cộng dồn,
// nên output thường gần bằng input. Vì vậy vẫn giữ ngưỡng riêng thận trọng: Full 80k, Lite 30k.
export const FULL_MERGE_CONTEXT_CHUNK_MAX_CHARS = 80000;
export const LITE_MERGE_CONTEXT_CHUNK_MAX_CHARS = 30000;
export const MERGE_CONTEXT_CHUNK_MAX_CHARS = IS_LITE
    ? LITE_MERGE_CONTEXT_CHUNK_MAX_CHARS
    : FULL_MERGE_CONTEXT_CHUNK_MAX_CHARS;

// Hạn sử dụng hợp nhất: Full theo EXPIRY_TS; Lite chỉ mở ngày 1-3 hàng tháng.
export const isWithinLicense = (): boolean => {
    if (IS_LITE) {
        const day = new Date().getDate();
        return day >= 1 && day <= 3;
    }
    return !ACCESS_CONFIG.EXPIRY_TS || Date.now() <= ACCESS_CONFIG.EXPIRY_TS;
};

// Cấu hình truy cập ứng dụng (Intro Page)
// Bạn có thể chỉnh sửa mã code và thời hạn ở đây cho tiện dụng
export const ACCESS_CONFIG = {
  // Bật/tắt tính năng yêu cầu nhập code bảo vệ ở màn hình Intro
  REQUIRE_CODE: true,

  // Hash SHA-256 của mật khẩu (hex) — không thể đảo ngược thành plaintext
  PASSWORD_HASH: '2cdeb943ec144a3d96f66f6049f471e16360af2f92cf3e6d56d2fa049158765a',

  // Expiry dạng timestamp UTC (Unix timestamp ms của ngày hết hạn)
  EXPIRY_TS: 1801414740000, // 2027-01-31T23:59:00+07:00

  // Nhãn gói bản quyền, chỉ khác nhau giữa các bản đóng gói (6 Tháng / 1 Năm /
  // Lite), hiển thị cạnh tên app ở Header và IntroPage để người dùng biết đang
  // dùng gói nào.
  EDITION: '5 Tháng'
};

// UPDATED v11.3.6: Adjusted RPD Limits to hard limits based on user feedback
const BASE_MODEL_CONFIGS: ModelQuota[] = [
  // PRO TIER: High Intelligence
  // Gemini 3.1 Pro: Giới hạn 100 RPD
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Siêu cấp)', rpmLimit: 2, rpdLimit: 100, priority: 1 , family: 'pro' },
  
  // FLASH TIER: High Speed
  // Gemini 3.7 Flash: model Flash mới nhất (ra mắt 13/08/2026), ưu tiên cao hơn 3.6 Flash.
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash (Mới nhất)', rpmLimit: 10, rpdLimit: 500, priority: 3.2 , family: 'flash' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash (Tối ưu)', rpmLimit: 10, rpdLimit: 500, priority: 3.4 , family: 'flash' },
  // Gemini 3.5 Flash: Giới hạn 500 RPD
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Kế Tiếp)', rpmLimit: 10, rpdLimit: 500, priority: 4 , family: 'flash' },
  // Gemini 3.0 Flash: Giới hạn 500 RPD
  { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash (Turbo)', rpmLimit: 10, rpdLimit: 500, priority: 3.5 , family: 'flash' },
  // Gemini 3.1 Flash Lite: Giới hạn 500 RPD
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', rpmLimit: 10, rpdLimit: 500, priority: 4.65 , family: 'flash-lite' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', rpmLimit: 10, rpdLimit: 500, priority: 4.9 , family: 'flash-lite' },
  
  // LITE TIER: Small models
  // UPDATED: thứ tự ưu tiên (priority càng thấp càng được chọn trước, xem quotaManager.getBestModelForTask)
  // giữa 4 model lite/gemma này được chỉnh lại thành 31B > 3.5 Flash Lite > 3.1 Flash Lite > 26B —
  // áp dụng cho MỌI nơi dùng chung MODEL_CONFIGS.priority (cả dịch Flash/Auto-Fix lẫn hậu kiểm Tier 2).
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B IT', rpmLimit: 10, rpdLimit: 500, priority: 4.55 , family: 'lite' },
  { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B IT', rpmLimit: 10, rpdLimit: 500, priority: 4.95 , family: 'lite' },

  // IMAGE TIER
  { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite', rpmLimit: 5, rpdLimit: 500, priority: 7 , family: 'image' },
];

// Bản Lite xoá hẳn model Pro khỏi danh sách (Header/quota bar/cài đặt model không còn hiển thị)
// FIX60: tra nhom model — fallback heuristic cho id lạ chưa kịp khai báo
export type ModelFamily = NonNullable<ModelQuota['family']>;
export const getModelFamily = (id: string): ModelFamily => {
    const cfg = BASE_MODEL_CONFIGS.find(m => m.id === id);
    if (cfg?.family) return cfg.family;
    if (/deepseek:/i.test(id)) return 'flash';
    if (/pro/i.test(id)) return 'pro';
    if (/(flash-)?lite|gemma/i.test(id)) return 'flash-lite';
    return 'flash';
};
export const MODEL_CONFIGS: ModelQuota[] = IS_LITE
    ? BASE_MODEL_CONFIGS.filter(m => m.id !== 'gemini-3.1-pro-preview')
    : BASE_MODEL_CONFIGS;

// Model FREE trên OpenRouter đã bị LOẠI BỎ HOÀN TOÀN khỏi hệ thống (fix44): vệ tinh cứu hộ
// duy nhất còn lại là DeepSeek (trả phí) — xem services/api/deepseek.ts và rescueTarget.ts.

// Bản Lite: mọi chức năng từng dùng 3.1 Pro chuyển sang 3.7 Flash (yêu cầu người dùng)
const PRO_MODEL_ID = IS_LITE ? 'gemini-3.7-flash' : 'gemini-3.1-pro-preview';

export const TIER_MODELS = {
    PRO_POOL: [PRO_MODEL_ID],
    FLASH_POOL: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it'], // Dùng để dịch trong Flash & Auto-Fix
};

export const CONCURRENCY_CONFIG = { 
    FLASH: 3, // Reduced to 3 per user request
    NORMAL: 3, 
    PRO: 2, // Strict serial processing for Pro to avoid TPM hit, bumped to 2 with spacing
    FULL: 3, // Reduced to 3 per user request
    LITE: 3
};

export const BATCH_SIZE_CONFIG = { FLASH: 5, NORMAL: 5, PRO: 5, FULL: 5, LITE: 5 };

// UPDATED: Batch size for repair increased to 150 lines to optimize API calls while staying within limits
export const REPAIR_CONFIG = { BATCH_SIZE: 150, CONCURRENCY: 2 };

export const AVAILABLE_LANGUAGES = ['Convert thô', 'Tiếng Trung', 'Tiếng Anh', 'Tiếng Hàn', 'Tiếng Nhật'];
export const AVAILABLE_GENRES = ['Tiên Hiệp', 'Huyền Huyễn', 'Đô Thị', 'Khoa Huyễn', 'Võng Du', 'Đồng Nhân', 'Kiếm Hiệp', 'Ngôn Tình', 'Dị Giới', 'Mạt Thế', 'Ngự Thú', 'Linh Dị', 'Hệ Thống', 'Hài Hước', 'Fantasy', 'Action', 'Light Novel', 'Isekai'];
export const AVAILABLE_PERSONALITIES = ['Vô sỉ/Cợt nhả', 'Lạnh lùng/Sát phạt', 'Cẩn trọng/Vững vàng', 'Thông minh/Đa mưu'];
export const AVAILABLE_SETTINGS = ['Trung Cổ/Cổ Đại', 'Hiện đại/Đô thị', 'Thập niên 80-90', 'Tương lai/Sci-fi', 'Mạt thế/Zombie', 'Võng Du/Game', 'Phương Tây/Magic'];
export const AVAILABLE_FLOWS = ['Phàm nhân lưu', 'Vô địch lưu', 'Phế vật lưu', 'Hệ thống lưu', 'Xuyên không lưu', 'Vô hạn lưu'];
