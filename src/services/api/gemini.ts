
import { logger } from "../../utils/logger";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { quotaManager } from '../../utils/quotaManager';
import { MODEL_CONFIGS, IS_LITE } from '../../constants';
import type { LogContext } from '../../types';
import { redactSensitiveText } from '../../utils/logSanitizer';
import { isGeminiV4RequestTimeoutError } from '../storyEngine/geminiV4RequestDeadline';

// ============================================================================
// FIX59 (bản Lite): API Key Gemini CÁ NHÂN do người dùng nhập.
// - Bản Full giữ nguyên key nhúng qua biến môi trường build (process.env.GEMINI_API_KEY).
// - Bản Lite TỪ CHỐI key nhúng: bắt buộc người dùng nhập key cá nhân (hỗ trợ NHIỀU key,
//   phân tách bằng dấu xuống dòng/dấu phẩy — giống cách nhập của DeepSeek), luân phiên
//   từng key theo lượt gọi. Key CHỈ tồn tại trong bộ nhớ phiên (module variable):
//   KHÔNG ghi localStorage/IndexedDB -> tự mất khi tải lại trang, KHÔNG bao giờ dính
//   vào backup/session file.
//
// FIX69 (bản Full 6 Tháng/1 Năm — quản lý API Key chuyên nghiệp hơn): trước đây bản Full
// CHỈ dùng đúng 1 key duy nhất mỗi phiên (`process.env.GEMINI_API_KEY || userGeminiKeys[0]`)
// — nếu người dùng dán NHIỀU key cá nhân, chỉ key ĐẦU TIÊN từng được dùng, các key còn lại
// nằm im không tác dụng, và quotaManager.registerApiKeys() luôn nhận mảng RỖNG cho bản Full
// nên toàn bộ cơ chế QUOTA-PER-KEY (fix65) vốn đã xây sẵn tổng quát chỉ thực sự chạy ở Lite.
// Giờ gộp chung 1 "HỒ BƠI HIỆU LỰC" (effective pool) cho CẢ 2 bản:
//   - Bản Full: hồ bơi = [key MẶC ĐỊNH (nhúng qua biến môi trường build, nếu có), ...key CÁ
//     NHÂN người dùng tự thêm]. Chưa thêm key cá nhân -> hồ bơi chỉ có đúng key mặc định
//     (hành vi vẫn y hệt trước đây với người dùng phổ thông). Có thêm key cá nhân -> xoay
//     vòng ĐỀU cả hồ bơi (không ưu tiên/không bỏ rơi key mặc định) — key mặc định tiếp tục
//     được dùng tới khi CHÍNH NÓ chạm giới hạn RPD riêng theo model đang chọn, đúng yêu cầu
//     "phải dùng hết quota key mặc định theo chế độ dịch đã chọn" thay vì bị thay thế hẳn.
//   - Bản Lite: không đổi — không có key mặc định, hồ bơi chỉ gồm key cá nhân, vẫn bắt buộc
//     phải nhập key.
// quotaManager.registerApiKeys() giờ luôn nhận đúng hồ bơi hiệu lực (không còn ép mảng rỗng
// cho bản Full) -> per-key quota/cooldown/depleted/round-robin hoạt động chuyên nghiệp cho
// CẢ 2 bản (xem quotaManager.ts — cờ perKeyEnabled không còn khoá cứng theo IS_LITE).
// ============================================================================
let userGeminiKeys: string[] = [];
let userKeyCursor = 0;
// fix65 (quota-per-key): id OPAQUE tương ứng 1-1 với userGeminiKeys (hash + 4 ký tự cuối).
// Dùng làm chìa khoá sổ per-key trong quotaManager — KHÔNG BAO GIỜ là raw key.
let userKeyIds: string[] = [];

const computeKeyId = (raw: string): string => {
    // FNV-1a 32-bit: đủ phân biệt các key thực tế, ổn định giữa các phiên, không đảo ngược được
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return 'k' + (h >>> 0).toString(36) + '_' + raw.slice(-4);
};

// fix69: key MẶC ĐỊNH nhúng qua biến môi trường build — CHỈ tồn tại ở bản Full (Lite luôn
// từ chối key nhúng, giữ nguyên yêu cầu bắt buộc nhập key cá nhân).
const DEFAULT_GEMINI_API_KEY: string | undefined =
    (!IS_LITE && process.env.GEMINI_API_KEY) ? process.env.GEMINI_API_KEY : undefined;
const DEFAULT_GEMINI_KEY_ID: string | undefined =
    DEFAULT_GEMINI_API_KEY ? computeKeyId(DEFAULT_GEMINI_API_KEY) : undefined;
export const hasDefaultGeminiKey = (): boolean => !!DEFAULT_GEMINI_API_KEY;

// fix69: hồ bơi HIỆU LỰC dùng để cấp client thật (getAiClient) và đăng ký với quotaManager.
// Luôn = [key mặc định?] + [key cá nhân...]. Tính lại mỗi khi danh sách key cá nhân đổi.
let effectiveKeys: string[] = [];
let effectiveKeyIds: string[] = [];

const recomputeEffectiveKeyPool = (): void => {
    if (DEFAULT_GEMINI_API_KEY && DEFAULT_GEMINI_KEY_ID) {
        effectiveKeys = [DEFAULT_GEMINI_API_KEY, ...userGeminiKeys];
        effectiveKeyIds = [DEFAULT_GEMINI_KEY_ID, ...userKeyIds];
    } else {
        effectiveKeys = [...userGeminiKeys];
        effectiveKeyIds = [...userKeyIds];
    }
    // fix69: đăng ký ĐÚNG hồ bơi hiệu lực cho quotaManager ở CẢ 2 bản (trước đây bản Full luôn
    // bị ép nhận mảng rỗng khiến mọi nhánh per-key no-op).
    quotaManager.registerApiKeys(effectiveKeyIds);
};
// Đăng ký ngay khi module nạp — để key mặc định (bản Full) có mặt trong quotaManager kể cả
// khi người dùng chưa mở bảng Cài đặt / chưa thêm key cá nhân nào.
recomputeEffectiveKeyPool();

export const setUserGeminiKeys = (raw: string): void => {
    const parsed = (raw || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    // FIX (báo cáo người dùng — bản Lite: "đã chèn API key hợp lệ, key không lỗi, nhưng app
    // không gọi được model nào"): quotaManager đánh dấu 1 model "hết Quota/depleted" theo TỪNG
    // MODEL, dùng CHUNG cho MỌI key cá nhân đã nhập (không phân biệt key nào gây lỗi), và cờ này
    // chỉ tự reset 1 lần/ngày theo lịch. Hệ quả: nếu 1 key cũ từng làm model X bị đánh dấu
    // depleted trong ngày (hết quota/lỗi liên tiếp), thì dù người dùng xoá key đó và dán vào 1
    // KEY MỚI HOÀN TOÀN (còn nguyên quota), app vẫn coi model X là "đã cạn" cho tới nửa đêm —
    // không có lỗi nào hiện ra ở bước nhập key (key mới vẫn hợp lệ), lỗi chỉ lộ ra âm thầm ở
    // bước gọi model thật (smartExecution từ chối gọi vì nghĩ model đã cạn). Khi danh sách key
    // THỰC SỰ thay đổi (khác key cũ, không phải chỉ gõ dở/thêm khoảng trắng), reset lại trạng
    // thái depleted/cooldown/lỗi liên tiếp của các model Gemini để key mới có cơ hội chạy từ đầu.
    const changed = parsed.join('|') !== userGeminiKeys.join('|');
    userGeminiKeys = parsed;
    userKeyIds = parsed.map(computeKeyId);
    userKeyCursor = 0;
    // fix69: tính lại hồ bơi hiệu lực (gồm cả key mặc định nếu có) và đăng ký lại với
    // quotaManager — chạy TRƯỚC nhánh reset để prune đúng state của key cá nhân đã xoá.
    recomputeEffectiveKeyPool();
    if (changed && parsed.length > 0) {
        quotaManager.resetDailyQuotas();
    }
};
export const getUserGeminiKeysRaw = (): string => userGeminiKeys.join('\n');
export const hasUserGeminiKey = (): boolean => userGeminiKeys.length > 0;

// fix69: danh sách hồ bơi key hiệu lực CHO UI (bảng "Quản Lý API Key Gemini" bản Full) — mỗi
// mục kèm nhãn dễ hiểu + 4 ký tự cuối để đối chiếu, KHÔNG BAO GIỜ lộ full raw key.
export interface GeminiKeyPoolEntry {
    id: string;
    label: string;
    maskedTail: string;
    isDefault: boolean;
}
export const getGeminiKeyPoolForUi = (): GeminiKeyPoolEntry[] => {
    const entries: GeminiKeyPoolEntry[] = [];
    if (DEFAULT_GEMINI_API_KEY && DEFAULT_GEMINI_KEY_ID) {
        entries.push({
            id: DEFAULT_GEMINI_KEY_ID,
            label: 'Mặc định (tự nạp)',
            maskedTail: DEFAULT_GEMINI_API_KEY.slice(-4),
            isDefault: true,
        });
    }
    userGeminiKeys.forEach((k, i) => {
        entries.push({ id: userKeyIds[i], label: `Cá nhân #${i + 1}`, maskedTail: k.slice(-4), isDefault: false });
    });
    return entries;
};

// Kênh "mở bảng nhập key" từ bất cứ luồng nghiệp vụ nào mà không phải khoan props xuyên
// nhiều tầng component: bắn event toàn cục, App.tsx lắng nghe để mở ApiSettingsModal;
// modal đọc consumePendingGeminiKeyTab() để tự nhảy đúng tab Gemini khi mở vì lý do này.
let pendingOpenGeminiTab = false;
export const requestGeminiKeySetup = (): void => {
    pendingOpenGeminiTab = true;
    try { window.dispatchEvent(new CustomEvent('open-gemini-key-settings')); } catch { /* ignore */ }
};
export const consumePendingGeminiKeyTab = (): boolean => {
    const v = pendingOpenGeminiTab;
    pendingOpenGeminiTab = false;
    return v;
};

// Chốt chặn dùng chung cho mọi luồng nghiệp vụ cần Gemini ở bản Lite: đủ key -> chạy
// bình thường; thiếu key -> mở bảng cài đặt và báo false để caller dừng.
export const ensureGeminiKeyForLite = (): boolean => {
    if (!IS_LITE || hasUserGeminiKey()) return true;
    requestGeminiKeySetup();
    return false;
};

// ============================================================================
// fix65 (quota-per-key): "scope key" cho 1 lượt chạy operation trên 1 model cụ thể.
// smartExecution gọi beginGeminiKeyScope(modelId) NGAY TRƯỚC khi chạy operation để hệ
// thống chọn giúp key tốt nhất còn usable (bỏ qua key đang cooldown/depleted riêng lẻ),
// và mọi lời getAiClient() phát sinh BÊN TRONG operation sẽ dùng đúng key đó thay vì
// xoay vòng mù. Dùng STACK vì operation có thể lồng nhau (auto-fix gọi tác vụ con);
// endGeminiKeyScope luôn cặp với begin theo kiểu LIFO.
//
// Hạn chế đã cân nhắc: nếu operation có await trước khi tạo client, một batch song song
// khác có thể chen scope — sai lệch chỉ ảnh hưởng việc GHI NHẬN quota vào key nào
// (tệ nhất: key lành bị tính oan vài lượt), KHÔNG bao giờ làm hỏng luồng chọn model.
// ============================================================================
const geminiKeyScopeStack: string[] = [];

export const beginGeminiKeyScope = (modelId?: string): string | null => {
    // fix69: dùng chung hồ bơi hiệu lực cho cả 2 bản (Full: mặc định + cá nhân, Lite: chỉ cá
    // nhân) thay vì chỉ bật cho Lite — bản Full giờ cũng có scope key thật để quota-per-key
    // hoạt động đúng ngay cả khi chỉ có 1 key mặc định.
    if (effectiveKeys.length === 0) return null;
    const picked = quotaManager.pickApiKeyForModel(modelId || '');
    const chosen = picked || effectiveKeyIds[0]; // chưa có state gì -> dùng key đầu tiên
    if (!chosen) return null; // phòng hờ: danh sách id lệch khỏi raw keys -> bỏ scope
    geminiKeyScopeStack.push(chosen);
    return chosen;
};

export const endGeminiKeyScope = (): void => {
    geminiKeyScopeStack.pop();
};

// ============================================================================
// FIX67 (đề xuất cải thiện fix65 — "truyền keyId xuyên suốt"): trước đây ghi nhận
// quota/depleted theo key dựa vào scope ĐẶT CHỖ TRƯỚC khi operation chạy; nếu operation có
// await trước khi tạo client, batch song song khác chen scope khiến GHI NHẬN sai key.
// Giờ wrapper bọc client SDK: mọi lỗi (kể cả lỗi GIỮA LUỒNG streaming) bị gắn thuộc tính
// __qkKeyId = id key THỰC TẾ đã phát sinh request đó -> smartExecution ghi nhận quota đúng
// key đã gọi thật, bất kể scope có bị chen hay không. Phần còn thiếu duy nhất: attribution
// thành công (recordSuccess) vẫn theo key đặt chỗ — chỉ ảnh hưởng bộ đếm RPD kế toán, không
// ảnh hưởng cooldown/depleted (các quyết định đắt giá nhất đều nằm phía lỗi).
// ============================================================================
const attachKeyToError = (e: any, keyId: string | undefined): any => {
    if (keyId && e && typeof e === 'object') {
        try { (e as any).__qkKeyId = keyId; } catch { /* lỗi đóng băng object — bỏ qua */ }
    }
    return e;
};

export const wrapAiClientWithTaggedKeyErrors = <T>(ai: T, apiKeyId: string | undefined): T => {
    const models = (ai as any)?.models;
    if (!apiKeyId || !models) return ai;
    const tagModels = new Proxy(models, {
        get(target: any, prop: string | symbol) {
            const orig = target[prop];
            if (typeof orig !== 'function') return orig;
            return (...args: any[]) => {
                let out: any;
                try { out = orig.apply(target, args); } catch (e) { throw attachKeyToError(e, apiKeyId); }
                const isPromise = out && typeof out.then === 'function';
                if (!isPromise) return out;
                if (String(prop) === 'generateContentStream') {
                    return Promise.resolve(out).then((res: any) => {
                        if (!res || !res.stream || typeof res.stream[Symbol.asyncIterator] !== 'function') return res;
                        // Bảo toàn nguyên vẹn các property/getter của result (kể cả .response),
                        // chỉ thay .stream bằng iterator có gắn tag lỗi giữa luồng.
                        const itFactory = res.stream[Symbol.asyncIterator].bind(res.stream);
                        const wrappedStream = {
                            [Symbol.asyncIterator]() {
                                const it = itFactory();
                                return {
                                    next: (...a: any[]) =>
                                        it.next(...a).catch((e: any) => { throw attachKeyToError(e, apiKeyId); }),
                                    ...(it.return ? { return: (...a: any[]) => it.return(...a) } : {}),
                                    ...(it.throw ? { throw: (...a: any[]) => it.throw(...a) } : {})
                                };
                            }
                        };
                        return Object.create(
                            Object.getPrototypeOf(res),
                            Object.assign(Object.getOwnPropertyDescriptors(res), {
                                stream: { value: wrappedStream, writable: true, configurable: true }
                            })
                        );
                    }, (e: any) => { throw attachKeyToError(e, apiKeyId); });
                }
                return out.then(
                    (v: any) => v,
                    (e: any) => { throw attachKeyToError(e, apiKeyId); }
                );
            };
        }
    });
    return new Proxy(ai as any, {
        get(target: any, prop: string | symbol) {
            if (prop === 'models') return tagModels;
            const v = target[prop];
            return typeof v === 'function' ? v.bind(target) : v;
        }
    }) as T;
};

export const getAiClient = () => {
  // fix69: cả 2 bản giờ dùng CHUNG hồ bơi hiệu lực (Full = mặc định + cá nhân, Lite = chỉ cá
  // nhân) — không còn nhánh riêng `apiKey = process.env.GEMINI_API_KEY || userGeminiKeys[0]`
  // (vốn chỉ dùng ĐÚNG 1 key duy nhất, bỏ quên mọi key cá nhân thêm sau key đầu tiên).
  if (effectiveKeys.length === 0) {
      if (IS_LITE) {
          throw new Error("Chưa cấu hình API Key Gemini cá nhân. Mở Cài đặt để nhập key (lấy miễn phí tại aistudio.google.com/apikey).");
      }
      throw new Error("Không tìm thấy API Key. Vui lòng kiểm tra biến môi trường build hoặc thêm API Key Gemini cá nhân trong Cài đặt.");
  }
  let apiKey: string;
  let issuedKeyId: string;
  // Ưu tiên key do smartExecution "đặt chỗ" cho model hiện tại (quota-per-key); các lời gọi
  // ngoài smartExecution (health-check, trang công cụ...) vẫn xoay vòng đều như cũ.
  const scopedId = geminiKeyScopeStack.length > 0 ? geminiKeyScopeStack[geminiKeyScopeStack.length - 1] : null;
  const scopedIdx = scopedId ? effectiveKeyIds.indexOf(scopedId) : -1;
  if (scopedIdx >= 0) {
      apiKey = effectiveKeys[scopedIdx];
      issuedKeyId = effectiveKeyIds[scopedIdx];
  } else {
      // Luân phiên đều cả hồ bơi theo từng lượt tạo client (mỗi lời gọi API tạo 1 client)
      const idx = userKeyCursor % effectiveKeys.length;
      userKeyCursor++;
      apiKey = effectiveKeys[idx];
      issuedKeyId = effectiveKeyIds[idx];
  }
  // FIX67 (giờ áp dụng cho CẢ 2 bản — fix69): bọc client để mọi lỗi SDK mang id key thực tế
  // (__qkKeyId) -> ghi nhận quota-per-key đúng key đã gọi thật, kể cả khi hồ bơi chỉ có 1 key
  // mặc định duy nhất (bản Full chưa thêm key cá nhân).
  return wrapAiClientWithTaggedKeyErrors(new GoogleGenAI({ apiKey }), issuedKeyId);
};

const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export { SAFETY_SETTINGS };

export const testCurrentKey = async (): Promise<{ success: boolean; message: string }> => {
    const ai = getAiClient();
    try {
        await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: "Hi",
            config: { safetySettings: SAFETY_SETTINGS }
        });
        return { success: true, message: "Key hợp lệ và còn Quota!" };
    } catch (error: any) {
        const msg = (error.message || error.toString()).toLowerCase();
        if (msg.includes("resource exhausted") || msg.includes("quota")) {
            return { success: false, message: "Key này đã hết Quota (Resource Exhausted)." };
        }
        if (msg.includes("api key not valid") || msg.includes("api_key_invalid") || (error.status === 400 && msg.includes('key'))) {
            return { success: false, message: "API Key không hợp lệ hoặc đã bị khóa." };
        }
        return { success: false, message: error.message };
    }
};

export const testModelConnection = async (modelId: string): Promise<{ success: boolean; message: string }> => {
    const ai = getAiClient();
    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: "Hi",
            config: { safetySettings: SAFETY_SETTINGS }
        });
        return response ? { success: true, message: "Kết nối thành công! Model sẵn sàng." } : { success: false, message: "Không có phản hồi." };
    } catch (error: any) {
        const msg = (error.message || error.toString()).toLowerCase();
        if (msg.includes("resource exhausted") || msg.includes("quota")) {
            quotaManager.markAsDepleted(modelId);
            return { success: false, message: "Model đã hết Quota (Resource Exhausted)." };
        }
        return { success: false, message: error.message };
    }
};

/**
 * "Vệ tinh" = các model không thuộc hệ Gemini nội bộ, không dùng quotaManager của Gemini,
 * mà tự quản lý key/rate limit riêng (DeepSeek). Trong smartExecution: chọn tuần tự theo
 * danh sách, lỗi thì loại khỏi danh sách thử (blacklist) thay vì đánh dấu "hết quota" theo
 * kiểu Gemini.
 */
const isSatelliteModel = (id: string) => id.startsWith('deepseek:');

// ============================================================================
// FIX66 — helpers xuất công khai để test đơn vị (tests/smartExecutionCause.test.ts)
// ============================================================================
export const EMPTY_RESULT_MARKER = 'kết quả rỗng';

/**
 * FIX66: quyết định DỪNG thử và ném lỗi ngay để tầng trên (useTranslator) vào nhánh
 * quét/cách ly tệp nghi vấn. Đúng khi: ≥2 model KHÁC NHAU cùng trả kết quả rỗng cho một
 * batch (gần như chắc chắn do NỘI DUNG bị bộ lọc chặn âm thầm, không phải hỏng model),
 * hoặc KHÔNG còn model nào khác khả dụng để chuyển sang.
 */
export const shouldBailOutToIsolationForEmptyResults = (
    distinctEmptyModels: number,
    otherUsableCandidateCount: number
): boolean => distinctEmptyModels >= 2 || otherUsableCandidateCount <= 0;

export type ExhaustionCauseTag = '[CAUSE:DEPLETED]' | '[CAUSE:BLACKLIST_TEMP]';
/**
 * FIX66: tag nguyên nhân khi hết mọi model để thử. Quy tắc MỚI (sửa bug dán nhãn sai):
 * còn BẤT KỲ model nào enabled && CHƯA depleted (kể cả đang nằm trong temporaryBlacklist
 * hoặc cooldown của LƯỢT chạy này) thì lượt retry MỚI vẫn có cơ hội thành công vì
 * temporaryBlacklist reset theo từng lượt -> phải là BLACKLIST_TEMP (tầng trên tự chờ rồi
 * thử lại). Chỉ khi TẤT CẢ đều depleted/bị tắt -> mới là DEPLETED (hết Quota thật).
 * Trước đây hễ CÓ 1 model cạn thật là dán DEPLETED cho cả lỗi — dù các model còn lại chỉ
 * lỗi tạm -> hệ thống DỪNG HẲN oan (sự cố: pro cạn thật nhưng 3.6/3.7 flash còn đầy quota
 * chỉ bị blacklist tạm vì trả kết quả rỗng -> app đứng luôn, phải reset data mới chạy lại).
 */
export const determineExhaustionCauseTag = (
    candidates: { enabled: boolean; depleted: boolean }[]
): ExhaustionCauseTag =>
    candidates.some(c => c.enabled && !c.depleted) ? '[CAUSE:BLACKLIST_TEMP]' : '[CAUSE:DEPLETED]';

export interface GoogleApiErrorDetails {
    httpStatus?: number;
    code?: string | number;
    status?: string;
    message: string;
}

const parseEmbeddedGoogleError = (rawMessage: string): any | undefined => {
    const start = rawMessage.indexOf('{');
    const end = rawMessage.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
        const parsed = JSON.parse(rawMessage.slice(start, end + 1));
        return parsed?.error || parsed;
    } catch {
        return undefined;
    }
};

const normalizeGoogleErrorPayload = (value: any): any | undefined => {
    if (!value) return undefined;
    if (typeof value === 'string') return parseEmbeddedGoogleError(value);
    if (typeof value === 'object') {
        return value.error && typeof value.error === 'object' ? value.error : value;
    }
    return undefined;
};

/**
 * Lấy đúng mã HTTP/code/status/message mà Google SDK trả về để ghi log chẩn đoán.
 * Không stringify toàn bộ error vì object SDK có thể chứa request/config nhạy cảm.
 */
export const getGoogleApiErrorDetails = (error: any): GoogleApiErrorDetails => {
    const rawMessage = typeof error?.message === 'string' ? error.message : String(error ?? 'Unknown error');
    // Một số phiên bản Google SDK đặt `error.error` thành CHUỖI JSON. Dùng chuỗi đó trực tiếp
    // làm `googleError` khiến `.status/.code` luôn undefined dù raw body có UNAVAILABLE/503.
    const nestedSource = error?.error || error?.response?.data?.error || error?.response?.body?.error;
    const nested = normalizeGoogleErrorPayload(nestedSource);
    const embedded = parseEmbeddedGoogleError(rawMessage);
    const googleError = nested || embedded || {};

    const numericStatusCandidates = [error?.status, error?.statusCode, error?.response?.status, googleError?.code];
    const httpStatus = numericStatusCandidates
        .map(v => typeof v === 'number' ? v : (typeof v === 'string' && /^\d{3}$/.test(v) ? Number(v) : undefined))
        .find(v => v !== undefined);
    const code = googleError?.code ?? error?.code ?? httpStatus;
    const symbolicStatus = googleError?.status
        ?? (typeof error?.status === 'string' && !/^\d{3}$/.test(error.status) ? error.status : undefined)
        ?? error?.statusText;
    const originalMessage = googleError?.message || rawMessage;

    return {
        httpStatus,
        code,
        status: symbolicStatus ? String(symbolicStatus) : undefined,
        message: redactSensitiveText(String(originalMessage), 600) || 'Không có message từ Google',
    };
};

export const formatGoogleApiErrorDetails = (error: any): string => {
    const details = getGoogleApiErrorDetails(error);
    const fields = [
        `HTTP ${details.httpStatus ?? 'không rõ'}`,
        `code=${details.code ?? 'không rõ'}`,
        `status=${details.status ?? 'không rõ'}`,
        `message=${details.message}`,
    ];
    return fields.join(' | ');
};

export const isGoogleServerError = (error: any, normalizedMessage?: string): boolean => {
    const details = getGoogleApiErrorDetails(error);
    const numericCode = Number(details.httpStatus ?? details.code);
    const symbolicStatus = (details.status || '').toUpperCase();
    const msg = normalizedMessage || details.message.toLowerCase();
    return (Number.isFinite(numericCode) && numericCode >= 500 && numericCode <= 599)
        || ['INTERNAL', 'UNAVAILABLE', 'UNKNOWN', 'DATA_LOSS'].includes(symbolicStatus)
        || msg.includes('500')
        || msg.includes('503')
        || msg.includes('overloaded');
};

// Backoff 5xx ngắn, tăng nhẹ và chặn trần để không giữ người dùng quá lâu ở một model đang nghẽn.
const SERVER_ERROR_BACKOFF_MS = [5000, 8000, 12000] as const;
export const getServerErrorBackoffMs = (attempt: number): number =>
    SERVER_ERROR_BACKOFF_MS[Math.min(Math.max(1, attempt), SERVER_ERROR_BACKOFF_MS.length) - 1];

// Giãn thời điểm BẮT ĐẦU request dùng chung giữa các batch. Delay 600ms cũ nằm bên trong từng
// worker nên 3 worker cùng ngủ rồi vẫn bắn request gần như đồng thời. Hàng đợi đặt chỗ đồng bộ
// này giữ concurrency xử lý, chỉ cách nhau 1.8s ở thời điểm khởi phát — phù hợp batch nhỏ 6-10.
export const GEMINI_LAUNCH_INTERVAL_MS = 1800;
export interface GeminiLaunchReservation { waitMs: number; nextLaunchAt: number; }
export const calculateGeminiLaunchReservation = (
    now: number,
    nextLaunchAt: number,
    intervalMs: number = GEMINI_LAUNCH_INTERVAL_MS,
): GeminiLaunchReservation => {
    const scheduledAt = Math.max(now, nextLaunchAt);
    return { waitMs: scheduledAt - now, nextLaunchAt: scheduledAt + intervalMs };
};

let nextGeminiLaunchAt = 0;
const waitForGeminiLaunchSlot = async (): Promise<number> => {
    const reservation = calculateGeminiLaunchReservation(Date.now(), nextGeminiLaunchAt);
    nextGeminiLaunchAt = reservation.nextLaunchAt;
    if (reservation.waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, reservation.waitMs));
    }
    return reservation.waitMs;
};

// Một batch đang retry 503 vẫn được giữ đúng backoff 5/8/12s hiện có. Các batch KHÁC tạm tránh
// model đó 20s để không cùng lao vào một model Google vừa báo high demand.
export const GOOGLE_SERVER_SOFT_COOLDOWN_MS = 20000;
export interface ServerSoftCooldownEntry { until: number; ownerExecutionId: number; }
export const getForeignServerCooldownRemainingMs = (
    entry: ServerSoftCooldownEntry | undefined,
    currentExecutionId: number,
    now: number = Date.now(),
): number => {
    if (!entry || entry.ownerExecutionId === currentExecutionId || entry.until <= now) return 0;
    return entry.until - now;
};

const serverSoftCooldownByModel = new Map<string, ServerSoftCooldownEntry>();
let smartExecutionSequence = 0;
const getServerSoftCooldownWait = (modelId: string, executionId: number): number => {
    const entry = serverSoftCooldownByModel.get(modelId);
    if (entry && entry.until <= Date.now()) {
        serverSoftCooldownByModel.delete(modelId);
        return 0;
    }
    return getForeignServerCooldownRemainingMs(entry, executionId);
};

/**
 * SMART EXECUTION ENGINE v3.1 (Retry Strategy)
 * - 2 Consecutive Errors -> Depleted.
 * - 1 Error -> Wait 1 minute -> Retry.
 * - Success -> Reset error count.
 */
export const smartExecution = async <T>(
    candidateModels: string[],
    operation: (modelId: string) => Promise<T>,
    taskName: string = "Tác vụ",
    onLog?: (msg: string, context?: LogContext) => void,
    preferredModelId?: string,
    priorityOverrides?: Record<string, number>
): Promise<T> => {
    const executionId = ++smartExecutionSequence;
    logger.log(`[smartExecution] task: ${taskName}, candidateModels:`, candidateModels);
    const validCandidates = candidateModels.filter(id => isSatelliteModel(id) || MODEL_CONFIGS.some(c => c.id === id));
    logger.log(`[smartExecution] task: ${taskName}, validCandidates:`, validCandidates);
    const temporaryBlacklist: string[] = []; // Models that completely failed in this execution
    // FIX66: các model ĐÃ từng trả kết quả rỗng trong LƯỢT chạy này (mỗi model tính đúng 1 lần)
    const emptyResultModels = new Set<string>();
    // Riêng 5xx phải đếm theo đúng LƯỢT smartExecution hiện tại. Không dùng consecutiveErrors
    // toàn cục vì bộ đếm đó còn gồm cả lỗi mạng/format từ batch trước, dễ báo sai "3 lỗi server".
    const serverErrorCounts = new Map<string, number>();
    
    if (validCandidates.length === 0) {
        throw new Error(`[${taskName}] Không có model nào khả dụng. Vui lòng kiểm tra lại cài đặt.`);
    }

    const MAX_ITERATIONS = 50;
    let iterations = 0;

    while (iterations++ < MAX_ITERATIONS) {
        // 1. Get Best Model
        let selectedId: string | null = null;
        const satelliteCandidates = validCandidates.filter(id => isSatelliteModel(id));
        const sharedCooldownModels = validCandidates.filter(id =>
            !isSatelliteModel(id) && getServerSoftCooldownWait(id, executionId) > 0
        );
        const selectionBlacklist = [...new Set([...temporaryBlacklist, ...sharedCooldownModels])];
        
        if (satelliteCandidates.length > 0) {
            selectedId = satelliteCandidates.find(id => !temporaryBlacklist.includes(id)) || null;
        } else {
            selectedId = quotaManager.getBestModelForTask(validCandidates, selectionBlacklist, preferredModelId, priorityOverrides);
            const imageFallbackId = 'gemini-3.1-flash-lite-image';
            if (!selectedId
                && validCandidates.includes(imageFallbackId)
                && !selectionBlacklist.includes(imageFallbackId)
                && quotaManager.isModelEnabled(imageFallbackId)
                && !quotaManager.isModelDepleted(imageFallbackId)
                && quotaManager.getWaitTimeForModel(imageFallbackId) <= 0) {
                selectedId = imageFallbackId;
            }
        }

        if (!selectedId) {
            // All exhausted or temporary blacklisted
            const allDepletedOrBlacklisted = validCandidates.every(id => 
                isSatelliteModel(id) ? temporaryBlacklist.includes(id) :
                ( (id !== 'gemini-3.1-flash-lite-image' && quotaManager.isModelDepleted(id)) || (id !== 'gemini-3.1-flash-lite-image' && !quotaManager.isModelEnabled(id)) || temporaryBlacklist.includes(id))
            );

            logger.log(`[smartExecution] task: ${taskName}, allDepletedOrBlacklisted:`, allDepletedOrBlacklisted, validCandidates.map(id => ({
                id,
                isDepleted: quotaManager.isModelDepleted(id),
                isEnabled: quotaManager.isModelEnabled(id),
                inBlacklist: temporaryBlacklist.includes(id),
                serverSoftCooldownMs: getServerSoftCooldownWait(id, executionId)
            })));

            if (allDepletedOrBlacklisted) {
                 if (temporaryBlacklist.length > 0 && temporaryBlacklist.length === validCandidates.length) {
                     // FIX: trước đây LUÔN throw message chứa "hết Quota" dù nguyên nhân thực sự có
                      // thể chỉ là vệ tinh (DeepSeek) gặp lỗi khác (mạng, sai key, bị chặn
                      // nội dung phía vệ tinh) — khiến người dùng hiểu lầm là hết Quota Gemini dù đã
                      // add đủ Key dự phòng. Tách riêng thông báo cho trường hợp toàn bộ candidate là
                      // vệ tinh để phản ánh đúng bản chất lỗi.
                     const allSatellite = validCandidates.every(id => isSatelliteModel(id));
                     if (allSatellite) {
                         throw new Error(`[${taskName}] Vệ tinh dự phòng (${temporaryBlacklist.join(', ')}) đều gặp lỗi — không phải do hết lượt gọi API Gemini chính. Xem log phía trên để biết lỗi cụ thể từng vệ tinh (có thể do giới hạn tốc độ riêng, key sai, hoặc bị chặn nội dung phía vệ tinh).`);
                     }
                     // FIX (bug "bị chặn bộ lọc âm thầm -> dừng hệ thống -> báo sai hết Quota"):
                      // gắn tag máy-đọc được phân biệt 2 tình huống có cùng message:
                      //  - [CAUSE:DEPLETED]       : TẤT CẢ model đều đã cạn quota thật / bị tắt
                      //    — không còn gì để chờ hay thử lại -> dừng.
                      //  - [CAUSE:BLACKLIST_TEMP] : VẪN CÒN model enabled && chưa depleted (chỉ
                      //    nằm trong temporaryBlacklist của LƯỢT gọi này — rất hay do bộ lọc nội
                      //    dung chặn ÂM THẦM khiến model trả kết quả rỗng/lặp vô nghĩa liên tục).
                      //    Tầng trên (useTranslator) sẽ tự chờ rồi thử lại, KHÔNG dừng hệ thống.
                      // FIX66: trước đây tag được chọn theo "CÓ ít nhất 1 model cạn thật" — sai:
                      // pro cạn thật nhưng 2 flash còn nguyên quota chỉ blacklist tạm vẫn bị dán
                      // DEPLETED -> app dừng hẳn oan (sự cố 18:05, log nhat-ky-loi 26/8).
                      // Giữ nguyên cụm từ cũ ở ĐẦU message để không vỡ các nơi đang dò chuỗi
                      // (streamTranslate re-throw list...).
                      const causeTag = determineExhaustionCauseTag(
                          validCandidates.filter(id => !isSatelliteModel(id)).map(id => ({
                              enabled: quotaManager.isModelEnabled(id),
                              depleted: quotaManager.isModelDepleted(id)
                          }))
                      );
                      throw new Error(`[${taskName}] Tất cả model đã thử đều gặp lỗi hoặc hết Quota. Dừng tác vụ. ${temporaryBlacklist.join(', ')} ${causeTag}`);
                 }
                 
                 // Đề xuất cải thiện tồn đọng ("phân tích sâu Quota thật vs backoff tạm"): message
                 // debug cũ chỉ liệt kê enabled/depleted/waitTime từng model mà KHÔNG kết luận rõ
                 // ngay đầu message bản chất tình huống là gì — người đọc phải tự suy ra. Tính thêm
                 // 1 dòng tóm tắt: phân biệt "đã CẠN QUOTA THẬT" (depleted=true) với "chỉ đang tạm
                 // nghỉ do giới hạn tốc độ" (waitTime hữu hạn, CHƯA depleted) — 2 tình huống khác hẳn
                 // bản chất (1 cần đợi lâu/đổi model, 1 tự hồi sau vài giây-phút). CHỈ đổi phần chữ
                 // hiển thị/log, KHÔNG đổi bất kỳ quyết định luồng nào ở trên (an toàn, không ảnh
                 // hưởng hành vi cứu hộ/blacklist hiện có).
                 const depletedCount = validCandidates.filter(id => id !== 'gemini-3.1-flash-lite-image' && quotaManager.isModelDepleted(id)).length;
                 const disabledCount = validCandidates.filter(id => id !== 'gemini-3.1-flash-lite-image' && !quotaManager.isModelEnabled(id)).length;
                 const backoffOnlyCount = validCandidates.filter(id => {
                     if (id === 'gemini-3.1-flash-lite-image') return false;
                     if (quotaManager.isModelDepleted(id) || !quotaManager.isModelEnabled(id)) return false;
                     const wt = quotaManager.getWaitTimeForModel(id);
                     return wt > 0 && wt !== Infinity;
                 }).length;
                  let natureSummary: string;
                  // FIX66: nhận diện đúng tình huống "model còn quota nhưng bị loại tạm" — đây
                  // là trường hợp TỰ HỒI PHỤC được (lượt retry mới có temporaryBlacklist sạch),
                  // phải đứng ĐẦU bảng tóm tắt thay vì dán nhãn "Một phần đã cạn Quota thật"
                  // gây hiểu lầm (sự cố: pro cạn thật nhưng 2 flash lỗi rỗng tạm -> báo sai).
                  const aliveButExcludedCount = validCandidates.filter(id =>
                      id !== 'gemini-3.1-flash-lite-image' &&
                      quotaManager.isModelEnabled(id) && !quotaManager.isModelDepleted(id)
                  ).length;
                  const causeTag = determineExhaustionCauseTag(
                      validCandidates.filter(id => !isSatelliteModel(id)).map(id => ({
                          enabled: quotaManager.isModelEnabled(id),
                          depleted: quotaManager.isModelDepleted(id)
                      }))
                  );
                  if (aliveButExcludedCount > 0) {
                      natureSummary = `CÁC MODEL VẪN CÒN QUOTA (${aliveButExcludedCount}/${validCandidates.length}) nhưng đã bị loại tạm trong lượt chạy này (thường do nội dung batch khiến model trả kết quả RỖNG/lỗi lặp lại — bộ lọc an toàn chặn ÂM THẦM, KHÔNG phải hết Quota). Hệ thống sẽ tự chờ rồi thử lại batch này.`;
                  } else if (depletedCount >= validCandidates.length) {
                      natureSummary = 'Đã CẠN QUOTA THẬT SỰ (toàn bộ model đủ điều kiện đều depleted=true).';
                  } else if (depletedCount > 0) {
                      natureSummary = `Một phần đã cạn Quota thật (${depletedCount}/${validCandidates.length} model), các model còn lại đều bị TẮT trong Cài đặt.`;
                  } else if (backoffOnlyCount > 0) {
                      natureSummary = `CHƯA cạn Quota thật - các model đủ điều kiện chỉ đang tạm nghỉ do giới hạn tốc độ (backoff), sẽ tự thử lại khi hết thời gian chờ.`;
                  } else if (disabledCount >= validCandidates.length) {
                      natureSummary = 'Không phải hết Quota - toàn bộ model đủ điều kiện đang bị TẮT trong Cài đặt.';
                  } else {
                      natureSummary = 'Nguyên nhân hỗn hợp - xem chi tiết từng model bên dưới.';
                  }

                  const diagnostics = validCandidates.map(id =>
                      `${id}: enabled=${quotaManager.isModelEnabled(id)}, depleted=${quotaManager.isModelDepleted(id)}, waitTime=${quotaManager.getWaitTimeForModel(id)}`
                  ).join('; ');
                 
                 throw new Error(`[${taskName}] Tất cả model khả dụng đã hết Quota hoặc bị tắt hoặc bị lỗi. ${natureSummary} Debug: ${diagnostics} ${causeTag}`);
            }

            // Waiting logic (Cooldown)
            const activeCandidates = validCandidates.filter(id => !isSatelliteModel(id) && !temporaryBlacklist.includes(id));
            // fix65 (quota-per-key): cộng thêm thời gian chờ cooldown RIÊNG của các key — khi mọi
            // key của 1 model đang bị 429 nghỉ ngắn hạn, chờ ĐỦ thời gian đó thay vì mặc định 2s
            // rồi gọi lại ngay và dính thêm 429 (lãng phí lượt thử của smartExecution).
            const waitTimes = activeCandidates.map(id => Math.max(
                quotaManager.getWaitTimeForModel(id),
                quotaManager.getApiKeyWaitForModel(id),
                getServerSoftCooldownWait(id, executionId)
            ));
            const minWaitTime = Math.min(...waitTimes);
            
            const actualWait = minWaitTime > 0 && minWaitTime !== Infinity ? minWaitTime : 2000;
            const waitSeconds = (actualWait / 1000).toFixed(1);

            if (onLog) onLog(`💤 Hệ thống đang điều phối tải (Chờ xen kẽ). Đợi ${waitSeconds}s...`);
            await new Promise(resolve => setTimeout(resolve, actualWait));
            continue; // Retry loop
        }

        // --- MODEL SELECTED ---
        if (!isSatelliteModel(selectedId)) {
            const launchWaitMs = await waitForGeminiLaunchSlot();
            if (launchWaitMs >= 250 && onLog) {
                onLog(`⏱️ Giãn nhịp gọi API ${(launchWaitMs / 1000).toFixed(1)}s để tránh các batch khởi phát cùng lúc...`, { operation: taskName, provider: 'gemini', modelId: selectedId, cause: 'request_pacing' });
            }
            quotaManager.recordRequest(selectedId);
        }

        // fix65 (quota-per-key): đặt chỗ key tốt nhất còn usable cho model này trước khi chạy
        // operation — mọi getAiClient() bên trong sẽ dùng đúng key đó, và toàn bộ ghi nhận
        // thành công/lỗi/quota phía dưới được tính vào RIÊNG key này. fix70 (sửa comment lỗi
        // thời do fix69 để lại): CÂU CŨ "bản Full: kk = undefined, mọi nhánh quay về hành vi
        // dùng chung cũ y hệt" KHÔNG còn đúng — từ fix69, beginGeminiKeyScope() dùng chung hồ
        // bơi hiệu lực (mặc định + cá nhân) cho CẢ 2 bản, nên `kk` có giá trị thật ở bản Full
        // bất cứ khi nào hồ bơi có ≥1 key (gần như luôn luôn). Chỉ khi hồ bơi RỖNG (build
        // thiếu GEMINI_API_KEY và chưa thêm key cá nhân — trường hợp lỗi cấu hình, hiếm gặp)
        // thì `beginGeminiKeyScope` mới trả `null` -> `kk` mới là `undefined`.
        const scopedKeyId = isSatelliteModel(selectedId) ? null : beginGeminiKeyScope(selectedId);
        const kk = scopedKeyId || undefined;
        const keyTag = kk ? ` [key …${kk.slice(-4)}]` : '';

        try {
            if (onLog) onLog(`🚀 [${taskName}] Đang chạy trên model: ${selectedId}${keyTag}...`, { operation: taskName, provider: isSatelliteModel(selectedId) ? 'deepseek' : 'gemini', modelId: selectedId, cause: 'request_started' });
            const result = await operation(selectedId);
            
            // SUCCESS: Reset consecutive errors
            if (!isSatelliteModel(selectedId)) {
                quotaManager.recordSuccess(selectedId, kk);
                const softCooldown = serverSoftCooldownByModel.get(selectedId);
                if (softCooldown?.ownerExecutionId === executionId) {
                    serverSoftCooldownByModel.delete(selectedId);
                }
            }
            if (scopedKeyId) endGeminiKeyScope();
            return result;
        } catch (error: any) {
            if (scopedKeyId) endGeminiKeyScope();
            // FIX67: ưu tiên id key THỰC TẾ mà SDK vừa dùng (wrapper gắn vào lỗi) thay vì key
            // đặt chỗ trước đó — chống sai lệch kế toán khi batch song song chen scope.
            const kkEff = ((error && error.__qkKeyId) as string | undefined) || kk;
            const effTag = kkEff ? ` [key …${kkEff.slice(-4)}]` : '';
            let msg = (error.message || error.toString()).toLowerCase();
            if (error.statusText) msg += " " + error.statusText.toLowerCase();

            // FIX (dừng phiên bị nuốt thành "hết Quota ảo"): lỗi ABORTED do người dùng chủ động
            // dừng không khớp nhánh phân loại nào bên dưới — rơi vào nhánh retry chung, mỗi
            // candidate model bị backoff thử lại ~3-4 lần vô ích rồi kết thúc bằng thông báo
            // "Tất cả model đã thử đều gặp lỗi hoặc hết Quota [CAUSE:BLACKLIST_TEMP]" gây hiểu
            // lầm. Người dùng đã dừng thì ném thẳng ra ngoài, không đụng quotaManager.
            if ((error.message || '') === 'ABORTED') throw error;

            // Story Engine V4 request deadlines already consumed the full per-attempt safety budget.
            // Skip this model immediately without quota/error accounting or same-model backoff. Legacy
            // callers are unaffected unless they explicitly throw the typed V4 timeout marker.
            if (isGeminiV4RequestTimeoutError(error)) {
                if (onLog) onLog(`Model ${selectedId} exceeded the Story Engine V4 request deadline. Trying the next enabled model.`, {
                    operation: taskName,
                    provider: 'gemini',
                    modelId: selectedId,
                    cause: 'request_timeout',
                });
                if (!temporaryBlacklist.includes(selectedId)) temporaryBlacklist.push(selectedId);
                continue;
            }

            const isQuotaError = msg.includes('429') || msg.includes('exceeded quota') || msg.includes('quota exceeded') || msg.includes('resource exhausted') || msg.includes('quota');
            const isInvalidKey = msg.includes('api key not valid') || msg.includes('api_key_invalid') || (error.status === 400 && msg.includes('key')) || msg.includes('401 unauthorized');
            const isSafetyError = !isQuotaError && (msg.includes('bộ lọc an toàn') || msg.includes('safety') || msg.includes('blocklist') || msg.includes('prohibited_content'));
            const isHallucinationError = msg.includes('lặp từ hoặc mất thẻ') || msg.includes('tỷ lệ >') || msg.includes('vượt giới hạn');
            
            if (isInvalidKey) {
                 throw new Error("API Key không hợp lệ hoặc đã bị khóa.", { cause: error });
            }

            // FIX (bug "cứu hộ DeepSeek không hoạt động, báo nhầm hết Quota"): trước đây
            // các nhánh isSafetyError/isQuotaError/500/403 bên dưới chạy TRƯỚC nhánh isSatelliteModel
            // (vốn nằm tít bên dưới, dòng ~260 cũ) — nghĩa là lỗi trả về từ vệ tinh DeepSeek
            // bị hệ phân loại lỗi CỦA GEMINI nuốt mất:
            //  - Nếu message lỗi của DeepSeek tình cờ chứa "safety"/"blocklist"... ->
            //    `throw error` NGAY LẬP TỨC (nhánh isSafetyError cũ) mà không hề thử candidate vệ
            //    tinh nào khác, và bên gọi không phân biệt được đây là lỗi Gemini hay vệ tinh.
            //  - Nếu message chứa "429"/"quota" (rất hay gặp vì DeepSeek cũng trả lỗi
            //    dạng "429 Too Many Requests" khi rate-limit hoặc khi bị chặn nội dung phía họ) ->
            //    lọt vào guồng quotaManager CỦA GEMINI (markAsDepleted/getConfigs tìm modelConfig
            //    theo id Gemini - không tồn tại với id "deepseek:..."), rồi sau
            //    khi đủ số lần lỗi liên tiếp sẽ throw thẳng "Tất cả model đã thử đều gặp lỗi hoặc
            //    hết Quota" - khiến người dùng tưởng lầm là HẾT QUOTA trong khi thực chất vệ tinh
            //    đang gặp lỗi khác (nghẽn mạng, sai key, hoặc chính vệ tinh cũng chặn nội dung).
            // Kết quả thực tế: tính năng "cứu hộ" coi như KHÔNG chạy — lỗi bị dán nhãn sai và toàn
            // bộ tác vụ dừng lại với thông báo gây hiểu lầm.
            // SỬA: xử lý lỗi vệ tinh NGAY TẠI ĐÂY, trước mọi nhánh phân loại quota/safety phía dưới
            // (vốn chỉ thiết kế cho Gemini) — luôn chỉ log + đưa vào temporaryBlacklist + thử
            // candidate vệ tinh kế tiếp (nếu có), không đụng gì tới quotaManager của Gemini.
            if (isSatelliteModel(selectedId)) {
                const reason = isSafetyError ? 'nghi vấn bộ lọc nội dung phía vệ tinh' : isQuotaError ? 'giới hạn tốc độ/quota riêng của vệ tinh' : 'lỗi khác';
                const shortMsg = redactSensitiveText(error.message || String(error), 200);
                if (onLog) onLog(`⛔ Vệ tinh ${selectedId} gặp lỗi (${reason}): ${shortMsg}. Loại khỏi danh sách thử lần này...`, { operation: taskName, provider: 'deepseek', modelId: selectedId, cause: reason });
                temporaryBlacklist.push(selectedId);
                continue;
            }

            // ============================================================================
            // FIX66 (bug "model trả kết quả rỗng -> lỗi 3 lần -> blacklist cả cụm -> báo nhầm
            // hết Quota [CAUSE:DEPLETED] -> DỪNG TOÀN HỆ THỐNG dù flash còn đầy quota"):
            //  - Lỗi "trả về kết quả rỗng" là TẤT ĐỊNH với cùng đầu vào (bộ lọc an toàn chặn
            //    âm thầm / server từ chối) — retry cùng payload chỉ đốt thời gian backoff
            //    2s/4s/8s rồi blacklist oan model (quan sát log sự cố 26/8 18:04-18:06).
            //  - Model ĐẦU TIÊN gặp rỗng: loại khỏi lượt & chuyển NGAY sang model khác.
            //  - Model THỨ HAI KHÁC cũng trả rỗng cùng batch (hoặc không còn model nào khả
            //    dụng): gần như chắc chắn do NỘI DUNG batch -> ném lỗi NGAY để useTranslator
            //    vào nhánh isolateUnsafeFiles: quét an toàn toàn batch -> quét riêng từng tệp
            //    -> cách ly/bàn giao cứu hộ đúng TỆP nghi vấn, các tệp lành được ghép lại dịch
            //    tiếp — hệ thống KHÔNG dừng, không reset data như trước.
            // Đặt TRƯỚC nhánh isSafetyError vì message gốc giờ có chứa cụm "bộ lọc an toàn"
            // (để tầng trên nhận diện), nếu không sẽ bị nuốt ngay ở lượt rỗng đầu tiên.
            // ============================================================================
            if (!isQuotaError && msg.includes(EMPTY_RESULT_MARKER)) {
                emptyResultModels.add(selectedId);
                const otherUsableCount = validCandidates.filter(id =>
                    id !== selectedId && !isSatelliteModel(id) &&
                    !temporaryBlacklist.includes(id) &&
                    quotaManager.isModelEnabled(id) && !quotaManager.isModelDepleted(id)
                ).length;
                if (shouldBailOutToIsolationForEmptyResults(emptyResultModels.size, otherUsableCount)) {
                    if (onLog) onLog(`🚨 ${emptyResultModels.size} model liên tiếp trả về kết quả RỖNG cho cùng batch (${[...emptyResultModels].join(', ')}) — nghi vấn nội dung bị bộ lọc an toàn chặn âm thầm. Trả lỗi ngay để quét & cách ly tệp nghi vấn thay vì đốt lượt retry vô ích...`);
                    throw error;
                }
                if (onLog) onLog(`⚠️ Model ${selectedId} trả về kết quả RỖNG. Loại model này và chuyển NGAY sang model dự phòng (không retry cùng nội dung)...`);
                temporaryBlacklist.push(selectedId);
                continue;
            }
            
            if (isSafetyError) {
                if (onLog) onLog(`⚠️ Model ${selectedId} trả về lỗi (có thể do Safety Filter / rỗng). Trả về lỗi ngay để chia nhỏ batch và thử lại...`);
                throw error; // Throw immediately so useTranslator can split the batch
            }
            
            if (isHallucinationError) {
                if (onLog) onLog(`⚠️ Model ${selectedId} bị ảo giác (lặp từ). Bỏ qua model này cho mẻ hiện tại.`);
                temporaryBlacklist.push(selectedId);
                continue; // Skip this model and try another one
            }
            
            if (isQuotaError) {
                // We no longer strictly isolate 'per day' strings to immediately deplete the model
                // because Google often returns 'GenerateRequestsPerDayPerProjectPerModel' even for rate limits.
                // It will go through the normal 429 retry logic below.
                
                // fix65 (quota-per-key): thang leo thang dưới đây chạy trên RIÊNG key vừa gặp 429
                // (kkEff — fix67: ưu tiên id key thực tế gắn trên lỗi). Key khác vẫn còn nguyên
                // trạng thái -> lượt điều phối kế tiếp chọn key đó NGAY thay vì bắt cả hệ thống chờ.
                quotaManager.recordQuotaError(selectedId, kkEff);
                const quotaErrorCount = quotaManager.getConsecutiveQuotaErrorsFor(selectedId, kkEff);
                
                // Check hard request limit from config
                const modelConfig = quotaManager.getConfigs().find((m: any) => m.id === selectedId);
                const requestsTodayForKey = quotaManager.getRequestsTodayFor(selectedId, kkEff);
                const isHardLimitReached = modelConfig && requestsTodayForKey >= modelConfig.rpdLimit;

                if (isHardLimitReached) {
                    if (onLog) onLog(`⛔ CƯỠNG CHẾ HẾT QUOTA${effTag}: Model ${selectedId} đã chạm ngưỡng giới hạn request cứng (${requestsTodayForKey}/${modelConfig!.rpdLimit}).`);
                    quotaManager.markAsDepleted(selectedId, kkEff);
                    // fix65: chỉ blacklist model khi KHÔNG còn key khác usable — còn key là còn
                    // cơ hội chạy tiếp cho cùng model ngay lượt kế tiếp.
                    if (!quotaManager.hasUsableApiKeyFor(selectedId)) temporaryBlacklist.push(selectedId);
                    continue;
                }

                // FIX51 (giữ nguyên tinh thần): KHÔNG markAsDepleted() (isDepleted=true vĩnh viễn
                // tới hết ngày) chỉ vì vài lần 429 dồn dập — con số đó rất dễ chỉ là burst
                // rate-limit (RPM) tạm thời, không phải thật sự cạn Quota ngày (RPD).
                //
                // FIX53 (bản này): fix51/52 sau khi bỏ markAsDepleted() ở nhánh này lại vô tình
                // tạo ra vòng lặp VÔ HẠN — mỗi lần cooldown 10 phút hết hạn, hệ thống tự thử lại,
                // vẫn dính 429 (vì Quota ngày thật sự đã cạn), quotaErrorCount lại tăng thêm 1
                // (3 -> 4 -> 5 -> 6...) rồi lại cooldown tiếp 10 phút — cứ thế lặp mãi, KHÔNG BAO
                // GIỜ chính thức báo "hết Quota" để dừng hẳn (bằng chứng: nhật ký lỗi người dùng
                // cung cấp cho thấy chuỗi "liên tục 3 lần" -> "4 lần" -> "5 lần" -> "6 lần" cách
                // nhau đúng ~10 phút, kéo dài nhiều giờ không dứt).
                //
                // SỬA: thêm bậc thang rõ ràng, có điểm dừng thật:
                //  - Lần 1/2/3 (quotaErrorCount 1-3): thử nhanh ngay, đợi 5s / 10s / 15s.
                //  - Lần 4: coi là "khá chắc bị rate-limit nặng" -> tạm nghỉ 1 phút (giảm từ 10
                //    phút, sau đó giảm tiếp từ 5 phút xuống 1 phút theo yêu cầu người dùng) rồi để
                //    hệ thống tự thử lại — CHƯA kết luận hết Quota thật.
                //  - Lần 5 trở đi (tức là SAU KHI đã nghỉ 1 phút rồi thử lại mà VẪN dính 429):
                //    đây mới là bằng chứng đủ mạnh -> chính thức markAsDepleted() (isDepleted=true
                //    tới hết ngày) và dừng hẳn model này, không lặp cooldown vô hạn nữa.
                if (quotaErrorCount >= 5) {
                     if (onLog) onLog(`⛔ Model ${selectedId}${effTag} vẫn báo lỗi Quota (429) sau khi đã tạm nghỉ 1 phút rồi thử lại — xác nhận key này đã hết Quota thực sự, khoá key này${kkEff ? ' (các key khác vẫn được thử)' : ', dừng model này'}.`, { operation: taskName, provider: 'gemini', modelId: selectedId, attempt: quotaErrorCount, httpStatus: 429, cause: 'quota_exhausted' });
                     quotaManager.markAsDepleted(selectedId, kkEff);
                     if (!quotaManager.hasUsableApiKeyFor(selectedId)) temporaryBlacklist.push(selectedId);
                     continue;
                } else if (quotaErrorCount === 4) {
                     if (onLog) onLog(`⏸️ Model ${selectedId}${effTag} báo lỗi Quota (429) liên tục ${quotaErrorCount} lần — tạm nghỉ key này 1 phút rồi tự thử lại, các model/key khác vẫn tiếp tục...`, { operation: taskName, provider: 'gemini', modelId: selectedId, attempt: quotaErrorCount, maxAttempts: 5, httpStatus: 429, cause: 'rate_limit_backoff' });
                     quotaManager.recordRateLimit(selectedId, 60000, kkEff);
                     if (!quotaManager.hasUsableApiKeyFor(selectedId)) temporaryBlacklist.push(selectedId);
                     continue;
                } else {
                     let waitTimeSeconds = 5;
                     if (quotaErrorCount === 2) waitTimeSeconds = 10;
                     else if (quotaErrorCount === 3) waitTimeSeconds = 15;

                     const waitTime = waitTimeSeconds * 1000;
                     if (onLog) onLog(`⚠️ Model ${selectedId}${effTag} dính Quota/Rate limit (429). Lần ${quotaErrorCount}, cho key này nghỉ ${waitTimeSeconds}s rồi thử lại...`, { operation: taskName, provider: 'gemini', modelId: selectedId, attempt: quotaErrorCount, maxAttempts: 5, httpStatus: 429, cause: 'rate_limit_retry' });
                     quotaManager.recordRateLimit(selectedId, waitTime, kkEff);
                     await new Promise(r => setTimeout(r, waitTime));
                     continue;
                }
            }

            if (error.status === 400 || msg.includes('400')) {
                if (onLog) onLog(`⚠️ CẢNH BÁO LỖI trên model ${selectedId}: ${msg.substring(0, 150)}.`);
            }

            if (isGoogleServerError(error, msg)) {
                quotaManager.recordError(selectedId);
                const serverErrorCount = (serverErrorCounts.get(selectedId) || 0) + 1;
                serverErrorCounts.set(selectedId, serverErrorCount);
                serverSoftCooldownByModel.set(selectedId, {
                    until: Date.now() + GOOGLE_SERVER_SOFT_COOLDOWN_MS,
                    ownerExecutionId: executionId,
                });
                const waitTime = getServerErrorBackoffMs(serverErrorCount);
                const waitSeconds = waitTime / 1000;
                const googleDetails = formatGoogleApiErrorDetails(error);
                const detailFields = getGoogleApiErrorDetails(error);
                const serverContext: LogContext = { operation: taskName, provider: 'gemini', modelId: selectedId, attempt: serverErrorCount, maxAttempts: 3, httpStatus: detailFields.httpStatus, apiStatus: detailFields.status, cause: 'server_error' };

                if (serverErrorCount >= 3) {
                     if (onLog) onLog(`🚨 Lỗi máy chủ Google trên ${selectedId}${effTag} (${serverErrorCount}/3): ${googleDetails}. Nghỉ ${waitSeconds}s rồi bỏ qua model này cho mẻ hiện tại; model KHÔNG bị đánh dấu hết quota.`, serverContext);
                     quotaManager.recordRateLimit(selectedId, waitTime);
                     await new Promise(r => setTimeout(r, waitTime));
                     temporaryBlacklist.push(selectedId);
                     // DO NOT markAsDepleted() vì đây chỉ là lỗi server tạm thời
                     continue;
                }

                if (onLog) onLog(`🚨 Lỗi máy chủ Google trên ${selectedId}${effTag} (${serverErrorCount}/3): ${googleDetails}. Đợi ${waitSeconds}s rồi thử lại...`, serverContext);
                quotaManager.recordRateLimit(selectedId, waitTime);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            if (error.status === 403 || msg.includes('403') || msg.includes('permission_denied')) {
                // FIX67 (bổ sung đúng thiết kế quota-per-key mà log fix65 đã mô tả nhưng bản code
                // trước đây thiếu): 403 = key này KHÔNG CÓ QUYỀN, không phải model hết Quota.
                // Khoá đúng key đó và giữ lại model để lượt kế tiếp chọn key khác cùng model.
                if (kkEff) {
                    if (onLog) onLog(`⛔ Model ${selectedId}${effTag} bị từ chối quyền truy cập (403). Khoá key này, thử key khác cho cùng model...`, { operation: taskName, provider: 'gemini', modelId: selectedId, httpStatus: 403, cause: 'permission_denied' });
                    quotaManager.markAsDepleted(selectedId, kkEff);
                    continue;
                }
                if (onLog) onLog(`⛔ CẢNH BÁO 403 FORBIDDEN trên model ${selectedId}: API Key hiện tại không có quyền truy cập.`, { operation: taskName, provider: 'gemini', modelId: selectedId, httpStatus: 403, cause: 'permission_denied' });
                quotaManager.markAsDepleted(selectedId);
                temporaryBlacklist.push(selectedId);
                continue;
            }

            // For satellite models (DeepSeek): đã xử lý ở TRÊN CÙNG catch block (xem
            // comment "FIX bug cứu hộ DeepSeek"), nên không bao giờ chạy tới đây nữa.
            // Giữ lại nhánh này (không xoá hẳn) chỉ để phòng hờ nếu sau này có thêm loại satellite
            // mới mà quên thêm vào `isSatelliteModel()`.
            if (isSatelliteModel(selectedId)) {
                if (onLog) onLog(`⛔ CẢNH BÁO: Model ${selectedId} lỗi (${msg.substring(0, 150)}). Loại bỏ khỏi danh sách thử.`);
                temporaryBlacklist.push(selectedId);
                continue;
            }

            // Normal Error Handle (Network, Parsed, Unknown)
            quotaManager.recordError(selectedId);
            
            const usage = quotaManager.getModelUsage(selectedId);
            const errorCount = usage.consecutiveErrors || 0;
            const maxRetries = 3;
            const hardErrorLimit = selectedId.includes("pro") ? 25 : 105;
            if (errorCount >= hardErrorLimit) {
                if (onLog) onLog(`⛔ CƯỠNG CHẾ HẾT QUOTA: Model ${selectedId} lỗi liên tiếp ${errorCount} lần. Đánh dấu hết Quota!`);
                quotaManager.markAsDepleted(selectedId);
                temporaryBlacklist.push(selectedId);
                continue;
            }

            if (errorCount <= maxRetries) {
                // STRIKE: Exponential Backoff (2s, 4s, 8s)
                const backoffSeconds = Math.pow(2, errorCount); 
                const waitTime = backoffSeconds * 1000;
                
                if (onLog) onLog(`⚠️ Lỗi lần ${errorCount}/${maxRetries} trên ${selectedId}. Đợi ${backoffSeconds}s trước khi thử lại... (${redactSensitiveText(msg, 50)}...)`, { operation: taskName, provider: 'gemini', modelId: selectedId, attempt: errorCount, maxAttempts: maxRetries, cause: 'unknown_retryable_error' });
                
                quotaManager.recordRateLimit(selectedId, waitTime);
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                // MAX STRIKES: Lỗi nặng, bỏ qua cho mẻ dịch này, NHƯNG không đánh dấu hết Quota
                if (onLog) onLog(`⛔ Model ${selectedId} lỗi ${maxRetries} lần liên tiếp không xác định rõ. Loại khỏi lần thử hiện tại.`, { operation: taskName, provider: 'gemini', modelId: selectedId, attempt: errorCount, maxAttempts: maxRetries, cause: 'unknown_error_blacklist' });
                temporaryBlacklist.push(selectedId);
            }
            
            // Short pause
            await new Promise(r => setTimeout(r, 500));
        }
    }

    throw new Error(`[${taskName}] Vượt quá số lần thử tối đa (${MAX_ITERATIONS}). Dừng tác vụ để tránh lặp vô hạn.`);
};
