// NÂNG CẤP #7 — TRANSLATION MEMORY (bộ nhớ dịch theo chương)
// Lưu cặp "nội dung gốc -> bản dịch đã duyệt" để khôi phục miễn phí khi file được xếp lại
// lịch dịch (retry/smart-fix/mở phiên mới) mà nội dung gốc TRÙNG KHỚP 100% với 1 chương đã
// dịch thành công trước đây. Đặc biệt có giá trị với retry sau lỗi bộ lọc: phần lớn file an
// toàn trong batch bị "vạ lây" được phục hồi miễn phí thay vì dịch lại từ đầu.
//
// NÂNG CẤP (đề xuất mục 4.1): kho lưu dời từ localStorage sang IndexedDB (kho
// 'app_translation_memory' chung DB 'TranslationAppDB') — BỎ giới hạn LRU 500 chương, lưu
// được truyện dài bao nhiêu cũng được. API chuyển sang bất đồng bộ; caller chính duy nhất là
// useTranslator (đã sửa kèm guard runId). Lần chạy đầu sau nâng cấp, dữ liệu cũ trong
// localStorage ('translation_memory_v1') được MIGRATE sang IndexedDB rồi xoá key cũ.
//
// Khoá tra cứu = hash(title truyện + nội dung gốc) — giữ nguyên công thức hash djb2 cũ nên
// key sinh ra trước/sau nâng cấp tương thích với nhau.
import { initDB, TM_STORE } from '../storage';

export const LEGACY_LOCALSTORAGE_KEY = 'translation_memory_v1';

export interface TranslationMemoryEntry {
    k: string;   // hash khoá
    title: string;
    src: string; // nội dung gốc (dùng để đối chiếu chính xác khi collision hash)
    dst: string; // bản dịch
    ts: number;  // thời điểm lưu (phục vụ sắp xếp/bảo trì về sau)
}

/** Giao diện lưu trữ tối thiểu — tách để unit-test được bằng driver trong bộ nhớ. */
export interface TMStorageDriver {
    get(keys: string[]): Promise<TranslationMemoryEntry[]>;
    put(entries: TranslationMemoryEntry[]): Promise<void>;
    deleteKeys(keys: string[]): Promise<void>;
    clear(): Promise<void>;
}

const computeHash = (text: string): string => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
};

const makeKey = (title: string | undefined, source: string): string =>
    `${(title || '__default__').trim().toLowerCase()}|${computeHash(source.trim())}`;

// ---------------------------------------------------------------------------
// Driver IndexedDB mặc định
// ---------------------------------------------------------------------------
const runTx = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>[] | void
): Promise<T[]> => {
    const db = await initDB();
    return new Promise<T[]>((resolve, reject) => {
        try {
            const results: T[] = [];
            const transaction = db.transaction(TM_STORE, mode);
            const store = transaction.objectStore(TM_STORE);
            const requests = fn(store);
            if (requests) for (const req of requests) {
                req.onsuccess = () => { results.push(req.result); };
            }
            transaction.oncomplete = () => resolve(results);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('TM transaction aborted'));
        } catch (e) { reject(e); }
    });
};

export const idbTMStorageDriver: TMStorageDriver = {
    async get(keys) {
        if (keys.length === 0) return [];
        const found = await runTx<TranslationMemoryEntry>('readonly', (store) =>
            keys.map(k => store.get(k))
        );
        return found.filter(e => !!e);
    },
    async put(entries) {
        if (entries.length === 0) return;
        await runTx('readwrite', (store) => {
            for (const entry of entries) store.put(entry);
        });
    },
    async deleteKeys(keys) {
        if (keys.length === 0) return;
        await runTx('readwrite', (store) => {
            for (const k of keys) store.delete(k);
        });
    },
    async clear() {
        await runTx('readwrite', (store) => { store.clear(); });
    }
};

// ---------------------------------------------------------------------------
// Migration một lần từ localStorage -> IndexedDB
// ---------------------------------------------------------------------------
let migrationPromise: Promise<void> | null = null;

/**
 * Chuyển toàn bộ entry TM cũ trong localStorage sang driver IDB rồi xoá key cũ.
 * Xuất riêng để unit-test được; trong app chỉ chạy đúng 1 lần cho driver mặc định.
 */
export const migrateLegacyLocalStorage = async (driver: TMStorageDriver): Promise<number> => {
    let raw: string | null = null;
    try { raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_LOCALSTORAGE_KEY) : null; } catch { raw = null; }
    if (!raw) return 0;
    try {
        const parsed = JSON.parse(raw) as Record<string, TranslationMemoryEntry>;
        const entries = Object.values(parsed || {}).filter(e => e && e.k && e.src && e.dst);
        if (entries.length === 0) {
            try { localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY); } catch { /* ignore */ }
            return 0;
        }
        await driver.put(entries.map(e => ({ ...e, ts: e.ts || Date.now() })));
        try { localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY); } catch { /* ignore */ }
        return entries.length;
    } catch {
        // Dữ liệu cũ hỏng/không parse được — xoá luôn để khỏi thử lại mãi.
        try { localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY); } catch { /* ignore */ }
        return 0;
    }
};

const ensureMigratedOnce = (): Promise<void> => {
    if (!migrationPromise) {
        migrationPromise = migrateLegacyLocalStorage(idbTMStorageDriver)
            .then(count => { if (count > 0) console.info(`Translation Memory: đã chuyển ${count} chương từ localStorage sang IndexedDB.`); })
            .catch(e => console.warn("Migration Translation Memory thất bại (sẽ thử lại lần sau):", e));
    }
    return migrationPromise;
};

// ---------------------------------------------------------------------------
// API công khai (bất đồng bộ)
// ---------------------------------------------------------------------------

/**
 * Tra cứu hàng loạt: trả Map "nội dung gốc (đã trim)" -> bản dịch cho các chương khớp.
 * Các nguồn không có trong TM sẽ vắng mặt trong Map. Không bao giờ reject vì TM lỗi
 * (chỉ là tối ưu hoá) — mọi lỗi trả Map rỗng.
 */
export const lookupTranslationMemory = async (
    title: string | undefined,
    sources: string[],
    driver: TMStorageDriver = idbTMStorageDriver
): Promise<Map<string, string>> => {
    const result = new Map<string, string>();
    const trimmed = Array.from(new Set(sources.filter(s => s && s.trim().length >= 20).map(s => s.trim())));
    if (trimmed.length === 0) return result;
    try {
        if (driver === idbTMStorageDriver) await ensureMigratedOnce();
        const keys = trimmed.map(src => makeKey(title, src));
        const entries = await driver.get(keys);
        for (const src of trimmed) {
            const key = makeKey(title, src);
            const entry = entries.find(e => e && e.k === key);
            // Chống collision hash: đối chiếu trực tiếp nội dung gốc
            if (entry && entry.src === src && entry.dst) result.set(src, entry.dst);
        }
    } catch (e) {
        console.warn("Tra cứu Translation Memory lỗi — bỏ qua (dịch bình thường qua API):", e);
    }
    return result;
};

/** Tra cứu 1 chương (tiện ích bọc lookupTranslationMemory). Trả null nếu không khớp. */
export const findTranslationMemory = async (
    title: string | undefined,
    source: string,
    driver: TMStorageDriver = idbTMStorageDriver
): Promise<string | null> => {
    if (!source || source.trim().length < 20) return null;
    const hits = await lookupTranslationMemory(title, [source], driver);
    return hits.get(source.trim()) ?? null;
};

/** Lưu nhiều cặp gốc->dịch một lần (gọi sau khi batch hoàn tất). Trả số cặp hợp lệ đã lưu. */
export const saveTranslationMemoryEntries = async (
    title: string | undefined,
    items: { src: string; dst: string }[],
    driver: TMStorageDriver = idbTMStorageDriver
): Promise<number> => {
    const now = Date.now();
    const valid = items
        .filter(i => i.src && i.dst && i.src.trim().length >= 20 && i.dst.trim().length > 0)
        .map(i => ({
            k: makeKey(title, i.src),
            title: (title || '__default__').trim(),
            src: i.src.trim(),
            dst: i.dst,
            ts: now,
        }));
    if (valid.length === 0) return 0;
    if (driver === idbTMStorageDriver) await ensureMigratedOnce();
    // KHÔNG còn cap LRU 500 như bản localStorage — truyện dài lưu thoải mái trong IndexedDB.
    await driver.put(valid);
    return valid.length;
};

/**
 * Xoá các cặp gốc->dịch theo NỘI DUNG GỐC (dùng khi người dùng chủ động "Dịch Lại" 1 chương
 * đã có bản dịch — tức bản dịch cũ bị bác bỏ, không được phép phục hồi lại nữa). Trả về số
 * entry đã xoá. Lưu ý khoá tra cứu phụ thuộc title truyện hiện tại: nếu title đã đổi sau khi
 * lưu thì xoá sẽ trượt (caller cần cơ chế chặn tra cứu riêng cho lượt đó).
 */
export const deleteTranslationMemoryEntries = async (
    title: string | undefined,
    sources: string[],
    driver: TMStorageDriver = idbTMStorageDriver
): Promise<number> => {
    const trimmed = Array.from(new Set(sources.filter(s => s && s.trim().length >= 20).map(s => s.trim())));
    if (trimmed.length === 0) return 0;
    if (driver === idbTMStorageDriver) await ensureMigratedOnce();
    const keys = trimmed.map(src => makeKey(title, src));
    const existing = await driver.get(keys);
    const existingKeys = new Set(existing.map(e => e.k));
    const toDelete = keys.filter(k => existingKeys.has(k));
    if (toDelete.length === 0) return 0;
    await driver.deleteKeys(toDelete);
    return toDelete.length;
};

/** Xoá toàn bộ bộ nhớ dịch. */
export const clearTranslationMemory = async (driver: TMStorageDriver = idbTMStorageDriver): Promise<void> => {
    await driver.clear();
};
