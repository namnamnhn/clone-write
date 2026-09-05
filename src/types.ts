
export enum FileStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  REPAIRING = 'REPAIRING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export type TranslationTier = 'flash' | 'normal' | 'pro' | 'full' | 'lite' | 'deepseek';

export interface BatchLimits {
    latin: { v36: number; v35: number; v31: number; v3: number; v25: number; maxTotalChars: number }; // Tiếng Việt, Convert
    complex: { v36: number; v35: number; v31: number; v3: number; v25: number; maxTotalChars: number }; // Raw, English, CJK
}

export interface RatioLimits {
    vn: { min: number; max: number };   // Vietnamese / Convert
    en: { min: number; max: number };   // English / Western
    krjp: { min: number; max: number }; // Korea / Japan
    cn: { min: number; max: number };   // Chinese
}

export interface FileItem {
  id: string;
  name: string;
  content: string;
  translatedContent: string | null;
  status: FileStatus;
  errorMessage?: string;
  retryCount: number;
  originalCharCount: number;
  remainingRawCharCount: number;
  usedModel?: string; // Track which model translated this file
  processingDuration?: number; // Time taken to process in milliseconds
  integrityRatio?: number;
  isFragmentedSource?: boolean;
  integrityOverrideAccepted?: boolean;
  ratioWarning?: string;
  // True khi tiêu đề chương hiện tại là do bước "Chuẩn hoá tiêu đề" (AI) tự sinh/format lại,
  // KHÔNG phải lấy nguyên văn từ bản gốc. Hậu kiểm (Tier 1 + Tier 2) dùng cờ này để không báo
  // oan "gốc không có tiêu đề nhưng dịch lại có tiêu đề" — vì đây là tính năng được cho phép.
  titleGeneratedByAI?: boolean;
  // Dạng chương phát hiện được lúc tách file từ văn bản gốc: có tiêu đề đầy đủ / chỉ có số thứ
  // tự / không có gì (thuần văn bản). Dùng để hậu kiểm áp đúng mức độ kỳ vọng cho từng dạng,
  // tránh áp tiêu chí "phải có tiêu đề" cho những chương vốn dĩ không có gì để đối chiếu.
  chapterFormat?: 'titled' | 'numbered' | 'untitled';
  // Đánh dấu translatedContent hiện tại là bản dịch bị hậu kiểm (Tier 1/2 trong validateBatch/
  // validateBatchWithAI) từ chối do nghi vấn nhầm/chập chương hay lệch tỷ lệ - nhưng KHÔNG bị
  // xoá, chỉ giữ lại để người dùng xem xét, và bị đẩy xuống cuối hàng chờ dịch lại. Bản dịch
  // nghi vấn này chỉ bị thay thế khi có bản dịch mới thành công (không còn bị hậu kiểm từ chối).
  // Cờ được reset (về false) khi: chạy Smart Fix, khôi phục Backup ở phiên làm việc mới, hoặc
  // khi người dùng bấm bắt đầu dịch lại (executeProcessing).
  hasStaleTranslation?: boolean;
  // Đánh dấu file đã được "Hậu kiểm khởi động" (startupTriage) xác nhận là lỗi thật (không
  // phải bị đánh oan) khi bấm Auto/bắt đầu phiên làm việc mới. Một khi đã khoá, executeProcessing()
  // KHÔNG được reset/đụng vào file này ở BẤT KỲ phiên nào (kể cả phiên hiện tại lẫn phiên mới sau
  // khi tải lại trang) - chỉ được đưa vào hàng chờ dịch khi tier đang chọn là 'deepseek'
  // (model cứu hộ). Chỉ được gỡ khi người dùng chủ động chọn file và Bắt đầu dịch lại,
  // hoặc dịch thành công qua model cứu hộ.
  isRescueLocked?: boolean;
  // FIX67 (đề xuất fix66): "hồ sơ tiền sử nội dung" của tệp — số lần tệp này được xác nhận/
  // nghi ngờ mạnh là nguyên nhân gây lỗi nội dung (Safety Filter chặn rõ, hoặc trả KẾT QUẢ
  // RỖNG âm thầm làm cả batch thất bại). Tăng ở isolateUnsafeFiles khi dán verdict cho tệp.
  // Dùng để: (a) các lần cách ly sau ưu tiên tệp "ngựa quỵ" có strikes cao nhất trước thay vì
  // mù tệp đầu tiên; (b) cảnh báo khi batch chứa tệp có tiền sử. Lưu theo state files nên tự
  // sống sót qua restart trang/kèm Backup như mọi thuộc tính FileItem khác.
  contentStrikes?: number;
  // FIX49-b: đếm số lần file đã được vá dòng raw ở đúng bước "Smart Fix (Pro Mode)" (không tính
  // lượt Auto-Fix In-stream đầu tiên bằng model rẻ ngay sau khi dịch xong). Trước đây vá dòng lặp
  // vô hạn tới khi remainingRawCharCount = 0 - nếu vài ký tự CJK đặc biệt (emoji, tên riêng cố ý
  // giữ nguyên...) khiến AI đúng đắn không sửa (vì không cần sửa) thì số đó không bao giờ về 0,
  // sinh vòng lặp gọi Smart Fix tốn API vô ích. Giới hạn ở MAX_SMART_FIX_RAW_ATTEMPTS (xem
  // smartFixCore.ts) lượt rồi bỏ cuộc êm, không báo lỗi. Reset về 0 khi file có nội dung dịch mới
  // thực sự (dịch lại toàn bộ, hoặc người dùng tự thay thế nội dung thủ công).
  rawFixAttemptCount?: number;
  // Tiêu đề EPUB do một nguồn tin cậy cung cấp. Story Studio dùng trường chỉ-đọc này để giữ
  // tiêu đề Canon tách khỏi văn xuôi; các luồng EPUB cũ không đặt trường nên không đổi hành vi.
  epubDisplayTitle?: string;
  shortContentKind?: 'story' | 'non_story' | 'uncertain';
  shortContentConfidence?: number;
  shortContentReason?: string;
  shortContentFingerprint?: string;
}

export interface ProcessingStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
}

export interface ContextPreset {
  id: string;
  name: string;
  content: string;
}

export interface StoryInfo {
  title: string;
  author: string;
  languages: string[]; // Multi-select support
  genres: string[];
  // New Fields
  mcPersonality: string[]; // Tính cách main (Vô sỉ, Cẩn trọng...)
  worldSetting: string[];  // Bối cảnh (Mạt thế, Hiện đại...)
  sectFlow: string[];      // Lưu phái (Phàm nhân lưu, Vô địch lưu...)
  contextNotes?: string; 
  summary?: string; // Tóm tắt cốt truyện (New v9.0)
  imagePrompt?: string; // Lưu prompt tạo ảnh để tái sử dụng hoặc tham khảo
  additionalRules?: string; // Quy tắc bổ sung từ người dùng (New v10.1)
  // Tùy chọn xưng hô khi chạy "Phân Tích Sâu" (deep_context): ép toàn bộ Series Bible/Ma trận
  // xưng hô theo 1 kiểu duy nhất (Hiện đại hoặc Cổ đại) thay vì để AI tự phân loại theo 3 NHÓM
  // A/B/C mặc định. 'flexible' (mặc định) = giữ nguyên hành vi phân tích sâu hiện tại.
  pronounMode?: 'modern' | 'ancient' | 'flexible';
  // Tùy chọn CHUẨN HÓA ĐƠN VỊ SỐ ĐẾM (vạn/ức Hán Việt cổ vs nghìn/triệu/tỷ hiện đại) khi chạy
  // "Phân Tích Sâu" — cùng cơ chế với pronounMode ở trên, tránh AI trộn lẫn 2 hệ đơn vị trong
  // cùng 1 truyện/chương (kể cả trong bảng thông số/hệ thống). 'flexible' (mặc định) = giữ
  // nguyên hành vi hiện tại (AI tự chọn theo bối cảnh, chỉ được nhắc nhất quán chung chung).
  numberUnitMode?: 'modern' | 'ancient' | 'flexible';
  enableTitleFormatting?: boolean; // Tắt bật chuẩn hóa tiêu đề
  enableAutoFormat?: boolean; // Tắt bật định dạng đoạn văn và lọc rác chung
  enableGarbageCleanOnImport?: boolean; // Tắt bật lọc rác sơ bộ (HTML rác, *#=, __/-- lặp...) tự động ngay lúc thêm file (zip/epub/docx/txt/pdf)
  titleFormat?: 'colon' | 'dash' | 'newline' | 'bracket'; // Định dạng tiêu đề chương
  tagFormat?: 'auto' | 'bracket' | 'xml'; // Tùy chọn định dạng tag
  translator?: string; // Dịch giả — hiển thị ở trang tựa EPUB (nếu bật)
  publisher?: string;  // NXB/Nhóm dịch — hiển thị ở trang tựa EPUB (nếu bật)
  // Story Studio không có tác giả công khai đáng tin cậy để suy diễn. Cờ chỉ thuộc snapshot
  // xuất bản cho phép modal bắt đầu trống và EPUB bỏ metadata tác giả nếu người dùng để trống.
  epubAllowBlankAuthor?: boolean;
}

// --- Cấu hình "Thiết Kế" (Design tab) cho xuất bản EPUB — tham khảo cấu trúc advancedStyle
// của các app tạo epub chuyên nghiệp (ảnh chương, drop cap, trang bìa/tựa full-bleed...).
// Đây là các giá trị THUẦN (không phải File), sống trong state của EpubPreviewModal, KHÔNG
// lưu vào StoryInfo/session — giống cách customFont hiện tại luôn reset mỗi lần mở modal.
export interface EpubDesignOptions {
  chapterIconPosition: 'top' | 'inline' | 'bottom'; // Vị trí ảnh banner so với chữ "Chương X"
  iconHeight: number; // Chiều cao ảnh banner chương, đơn vị em
  enableDropCaps: boolean; // Chữ cái đầu chương to (drop cap)
  dropCapLines: number; // Drop cap cao bao nhiêu dòng
  dividerOrnament: string; // Hoa văn chữ dùng ngăn cảnh khi KHÔNG có ảnh divider, vd "❧"
  dividerIconWidth: number; // Chiều rộng ảnh ngăn cảnh, đơn vị em
  chapterTextAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  paragraphSpacing: number; // em
  indentFirstLine: boolean;
  hyphenation: boolean;
  enableCoverPage: boolean; // Sinh trang bìa full-bleed riêng làm trang đầu sách
  enableTitlePage: boolean; // Sinh trang tựa (tên sách/tác giả/dịch giả/NXB)
  titlePageStyle: 'classic' | 'modern' | 'minimal';
}

export const DEFAULT_EPUB_DESIGN_OPTIONS: EpubDesignOptions = {
  chapterIconPosition: 'top',
  iconHeight: 4,
  enableDropCaps: false,
  dropCapLines: 3,
  dividerOrnament: '❧',
  dividerIconWidth: 5,
  chapterTextAlign: 'center',
  lineHeight: 1.5,
  paragraphSpacing: 1.5,
  indentFirstLine: true, // true = mọi đoạn thụt đầu dòng 1.5em (giữ đúng hành vi mặc định trước đây)
  hyphenation: false,
  enableCoverPage: false,
  enableTitlePage: false,
  titlePageStyle: 'classic',
};

// Các "tài sản" nhị phân (File) cho Design tab: font tiêu đề/nội dung tách riêng, ảnh
// banner đầu mỗi chương, ảnh hoa văn ngăn cảnh. Tất cả optional — không chọn gì thì dùng mặc định.
export interface EpubDesignAssets {
  titleFont: File | null;
  contentFont: File | null;
  chapterIcon: File | null;
  dividerIcon: File | null;
}

export const EMPTY_EPUB_DESIGN_ASSETS: EpubDesignAssets = {
  titleFont: null,
  contentFont: null,
  chapterIcon: null,
  dividerIcon: null,
};

export interface ModelQuota {
  id: string;
  name: string;
  rpmLimit: number; // Requests Per Minute
  rpdLimit: number; // Requests Per Day
  priority: number; // 1 is highest
  // FIX60: nhóm model khai báo tường minh — nguồn chân lý duy nhất khi cần phân biệt
  // Pro/Flash/Flash-Lite/Lite (thay cho so-chuỗi id vốn dễ xếp nhầm khi thêm model mới).
  family?: 'pro' | 'flash' | 'flash-lite' | 'lite' | 'image';
}

export interface ModelUsage {
  requestsToday: number; // Count for today
  lastResetDate: string; // YYYY-MM-DD
  recentRequests: number[]; // Timestamps for RPM calculation
  cooldownUntil: number; // Timestamp when model is available again (0 if ready)
  isDepleted: boolean; // True if daily limit reached
  consecutiveErrors: number; // Track consecutive general failures
  consecutiveQuotaErrors?: number; // Track consecutive QUOTA failures
}

// --- SHARED UI TYPES ---
export interface Toast {
    id: string; 
    message: string; 
    type: 'success' | 'error' | 'info' | 'warning'; 
}

export interface LogContext {
    operation?: string;
    provider?: 'gemini' | 'deepseek' | 'system';
    modelId?: string;
    runId?: string;
    batchId?: string;
    attempt?: number;
    maxAttempts?: number;
    httpStatus?: number;
    apiStatus?: string;
    cause?: string;
    durationMs?: number;
}

export interface LogEntry { 
    id: string; 
    timestamp: Date; 
    message: string; 
    type: 'success' | 'error' | 'info' | 'warning'; 
    context?: LogContext;
}

export interface AutomationConfig {
    steps: number[];
    additionalRules: string;
    tier: TranslationTier;
    // Pool model chỉ dùng cho Bước 4 (Dịch), độc lập với model hỗ trợ hậu kiểm/Smart Fix.
    translationModels?: string[];
    // NEW: Engine dùng cho các bước phân tích/dịch (Auto Phân Tích, Phân Tích Sâu, Thiết Kế
    // Prompt, Dịch, Auto Fix, Smart Fix, Hậu Kiểm). Riêng tạo bìa luôn dùng Gemini bất kể engine.
    // Mặc định 'gemini' để tương thích ngược với các nơi tạo AutomationConfig cũ.
    engine?: 'gemini' | 'deepseek';
}

export interface GlobalRepairEntry { 
    fileId: string; 
    lineIndex: number; 
    originalLine: string; 
}

export interface CreativeChapter {
    id: string;
    title: string;
    content: string;
    status?: 'completed' | 'failed' | 'retrying';
    retryCount?: number;
}

export interface SinoVietnameseState {
    unfixedList: string;
    fixedList: string;
}

export interface FixErrorState {
    prompt: string;
    rawErrors?: string;
    processedFixes?: string;
    fixImages?: string[];
    imageBase64: string | null;
}

export interface Character {
    id: string;
    name: string;
    gender: string;
    age: string;
    role: string;
    appearance: string;
    personality: string;
}

// Snapshot trạng thái Sáng Tác được chụp tự động NGAY TRƯỚC khi áp dụng 1 lượt "Viết Tiếp" mới
// vào state — cho phép khôi phục lại nếu lượt viết mới không ưng ý (lạc đề, sai văn phong, AI
// viết hỏng...) mà không mất phần đã viết trước đó. Chỉ giữ tối đa CREATIVE_SNAPSHOT_LIMIT bản
// gần nhất (xem useCreativePage.ts) để tránh phình state/localStorage vô hạn theo thời gian.
export interface CreativeSnapshot {
    id: string;
    createdAt: number; // Date.now() lúc chụp
    chapterCountBefore: number; // Số chương TRƯỚC lượt viết này, hiển thị cho người dùng dễ chọn
    chapters: CreativeChapter[];
    characters: Character[];
    premise: string; // setup.premise lúc chụp (tóm tắt truyện)
}

export interface CreativeState {
    prompt: string;
    chapters: CreativeChapter[];
    summary: string;
    suggestions: string[];
    isGenerating: boolean;
    isSummarizing: boolean;
    targetChapters: number; // Used as batch size now
    totalTargetChapters?: number; // Total chapters for the whole book
    autoGenerateTarget?: number;
    customNextPrompt?: string;
    setup?: any;
    characters?: Character[];
    snapshots?: CreativeSnapshot[];
}
