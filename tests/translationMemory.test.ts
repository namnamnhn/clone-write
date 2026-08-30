import { describe, it, expect, beforeEach } from 'vitest';
import {
    lookupTranslationMemory,
    findTranslationMemory,
    saveTranslationMemoryEntries,
    deleteTranslationMemoryEntries,
    clearTranslationMemory,
    migrateLegacyLocalStorage,
    LEGACY_LOCALSTORAGE_KEY,
    type TranslationMemoryEntry,
    type TMStorageDriver,
} from '../src/utils/text/translationMemory';

// Hồi quy fix36 (phiên sau): lỗi "Dịch Lại không có tác dụng với file đã có bản dịch".
// Nguyên nhân: file từng dịch thành công được lưu vào Translation Memory; khi bấm Dịch Lại,
// scheduler khớp TM và gắn TRẢ LẠI đúng bản cũ (usedModel='TM', 0 request API). Vá bằng cách
// xoá entry TM + cấm tra cứu cho id được dịch lại.
//
// NÂNG CẤP mục 4.1: kho lưu dời từ localStorage sang IndexedDB — API chuyển bất đồng bộ và
// nhận driver tiêm vào được nên các test chạy với driver trong bộ nhớ (môi trường node không
// có IndexedDB). Phần cấm tra cứu theo file id nằm trong effect của useTranslator, không
// unit-test trực tiếp được.
const LONG_SRC_1 = 'Nội dung gốc chương một phải dài hơn hai mươi ký tự để TM chấp nhận.';
const LONG_SRC_2 = 'Nội dung gốc chương hai cũng phải dài hơn hai mươi ký tự để TM chấp nhận.';

const mkMemoryDriver = (): TMStorageDriver & { dump(): Map<string, TranslationMemoryEntry> } => {
    const store = new Map<string, TranslationMemoryEntry>();
    return {
        async get(keys) { return keys.map(k => store.get(k)).filter(e => !!e); },
        async put(entries) { for (const e of entries) store.set(e.k, { ...e }); },
        async deleteKeys(keys) { for (const k of keys) store.delete(k); },
        async clear() { store.clear(); },
        dump() { return store; },
    };
};

const mkLocalStorageStub = () => {
    const backing = new Map<string, string>();
    return {
        getItem: (k: string) => (backing.has(k) ? (backing.get(k) as string) : null),
        setItem: (k: string, v: string) => { backing.set(k, String(v)); },
        removeItem: (k: string) => { backing.delete(k); },
        clear: () => { backing.clear(); },
    };
};

let driver: ReturnType<typeof mkMemoryDriver>;

beforeEach(() => {
    driver = mkMemoryDriver();
    (globalThis as Record<string, unknown>).localStorage = mkLocalStorageStub();
});

describe('Translation Memory - tra cứu & lưu', () => {
    it('lưu rồi tra cứu hàng loạt -> trả đúng cặp khớp, bỏ qua nội dung chưa có', async () => {
        await saveTranslationMemoryEntries('Truyện A', [
            { src: LONG_SRC_1, dst: 'Bản dịch 1' },
            { src: LONG_SRC_2, dst: 'Bản dịch 2' },
            { src: 'ngắn quá', dst: 'không hợp lệ' },
        ], driver);

        const hits = await lookupTranslationMemory('Truyện A', [LONG_SRC_1, LONG_SRC_2, 'Chưa có trong TM nào hết sức dài dòng'], driver);
        expect(hits.get(LONG_SRC_1.trim())).toBe('Bản dịch 1');
        expect(hits.get(LONG_SRC_2.trim())).toBe('Bản dịch 2');
        expect(hits.size).toBe(2);
    });

    it('findTranslationMemory trả null khi chưa có hoặc nội dung quá ngắn', async () => {
        expect(await findTranslationMemory('Truyện A', LONG_SRC_1, driver)).toBeNull();
        await saveTranslationMemoryEntries('Truyện A', [{ src: LONG_SRC_1, dst: 'Bản dịch 1' }], driver);
        expect(await findTranslationMemory('Truyện A', LONG_SRC_1, driver)).toBe('Bản dịch 1');
        expect(await findTranslationMemory('Truyện A', 'ngắn', driver)).toBeNull();
    });
});

describe('Translation Memory - deleteTranslationMemoryEntries', () => {
    it('xoá đúng entry đã lưu -> findTranslationMemory trả null sau khi xoá', async () => {
        await saveTranslationMemoryEntries('Truyện A', [{ src: LONG_SRC_1, dst: 'Bản dịch 1' }], driver);
        expect(await findTranslationMemory('Truyện A', LONG_SRC_1, driver)).toBe('Bản dịch 1');

        const deleted = await deleteTranslationMemoryEntries('Truyện A', [LONG_SRC_1], driver);
        expect(deleted).toBe(1);
        expect(await findTranslationMemory('Truyện A', LONG_SRC_1, driver)).toBeNull();
    });

    it('chỉ xoá đúng các entry được chỉ định, giữ nguyên entry khác', async () => {
        await saveTranslationMemoryEntries('Truyện A', [
            { src: LONG_SRC_1, dst: 'Bản dịch 1' },
            { src: LONG_SRC_2, dst: 'Bản dịch 2' },
        ], driver);

        const deleted = await deleteTranslationMemoryEntries('Truyện A', [LONG_SRC_1], driver);
        expect(deleted).toBe(1);
        expect(await findTranslationMemory('Truyện A', LONG_SRC_1, driver)).toBeNull();
        expect(await findTranslationMemory('Truyện A', LONG_SRC_2, driver)).toBe('Bản dịch 2');
    });

    it('trả về 0 và không lỗi khi nội dung chưa từng có trong TM', async () => {
        expect(await deleteTranslationMemoryEntries('Truyện A', [LONG_SRC_1], driver)).toBe(0);
    });

    it('bỏ qua nội dung quá ngắn (<20 ký tự) thay vì tạo khoá rác', async () => {
        await saveTranslationMemoryEntries('Truyện A', [{ src: LONG_SRC_1, dst: 'Bản dịch 1' }], driver);
        expect(await deleteTranslationMemoryEntries('Truyện A', ['ngắn'], driver)).toBe(0);
        expect(await findTranslationMemory('Truyện A', LONG_SRC_1, driver)).toBe('Bản dịch 1');
    });

    it('khoá phụ thuộc title truyện: title đổi thì xoá trượt (tài liệu hoá giới hạn đã biết)', async () => {
        await saveTranslationMemoryEntries('Tiêu đề cũ', [{ src: LONG_SRC_1, dst: 'Bản dịch 1' }], driver);
        // Người dùng đổi tên truyện sau khi dịch rồi mới bấm Dịch Lại -> xoá theo title mới
        // không trúng entry cũ; lượt đó được che bởi cơ chế cấm tra cứu theo file id trong useTranslator.
        expect(await deleteTranslationMemoryEntries('Tiêu đề mới', [LONG_SRC_1], driver)).toBe(0);
        expect(await findTranslationMemory('Tiêu đề cũ', LONG_SRC_1, driver)).toBe('Bản dịch 1');
    });

    it('ghi đè sau xoá: bản dịch MỚI được lưu lại bình thường sau khi bản cũ bị xoá', async () => {
        await saveTranslationMemoryEntries('Truyện A', [{ src: LONG_SRC_1, dst: 'Bản cũ bị bác bỏ' }], driver);
        await deleteTranslationMemoryEntries('Truyện A', [LONG_SRC_1], driver);

        await saveTranslationMemoryEntries('Truyện A', [{ src: LONG_SRC_1, dst: 'Bản dịch mới đẹp hơn' }], driver);
        expect(await findTranslationMemory('Truyện A', LONG_SRC_1, driver)).toBe('Bản dịch mới đẹp hơn');
    });
});

describe('Translation Memory - NÂNG CẤP 4.1 (IndexedDB)', () => {
    it('không còn cap LRU 500: lưu vượt 500 chương vẫn tra cứu đủ', async () => {
        const items = Array.from({ length: 520 }, (_, i) => ({
            src: `Nội dung gốc chương số ${i} phải đủ dài để TM chấp nhận lưu bình thường.`,
            dst: `Bản dịch chương số ${i}.`,
        }));
        expect(await saveTranslationMemoryEntries('Truyện dài', items, driver)).toBe(520);
        const hits = await lookupTranslationMemory('Truyện dài', items.map(i => i.src), driver);
        expect(hits.size).toBe(520);
        expect(driver.dump().size).toBe(520);
    });

    it('migration: entry cũ trong localStorage được đưa sang IDB rồi xoá key cũ', async () => {
        // Giả lập dữ liệu cũ do bản localStorage tạo ra
        const legacyEntry = {
            k: `${'truyện a'}|legacy-hash`,
            title: 'Truyện A',
            src: LONG_SRC_1,
            dst: 'Bản dịch legacy',
            ts: 1234567890,
        };
        // Khoá thật phải sinh bằng cùng công thức makeKey -> lưu qua API trước trên driver khác
        const seedDriver = mkMemoryDriver();
        await saveTranslationMemoryEntries('Truyện A', [{ src: LONG_SRC_1, dst: 'Bản dịch legacy' }], seedDriver);
        const realKey = Array.from(seedDriver.dump().keys())[0];
        const rawLegacyStore = JSON.stringify({ [realKey]: { ...legacyEntry, k: realKey } });
        (globalThis as { localStorage: unknown }).localStorage = mkLocalStorageStub();
        (globalThis as { localStorage: Storage }).localStorage.setItem(LEGACY_LOCALSTORAGE_KEY, rawLegacyStore);

        const migrated = await migrateLegacyLocalStorage(driver);
        expect(migrated).toBe(1);
        expect((globalThis as { localStorage: Storage }).localStorage.getItem(LEGACY_LOCALSTORAGE_KEY)).toBeNull();
        expect(await findTranslationMemory('Truyện A', LONG_SRC_1, driver)).toBe('Bản dịch legacy');
    });

    it('migration: localStorage rỗng/hỏng -> trả 0, không lỗi, dọn key hỏng', async () => {
        expect(await migrateLegacyLocalStorage(driver)).toBe(0);
        (globalThis as { localStorage: Storage }).localStorage.setItem(LEGACY_LOCALSTORAGE_KEY, '{json hỏng!!!');
        expect(await migrateLegacyLocalStorage(driver)).toBe(0);
        expect((globalThis as { localStorage: Storage }).localStorage.getItem(LEGACY_LOCALSTORAGE_KEY)).toBeNull();
    });

    it('clearTranslationMemory xoá sạch kho', async () => {
        await saveTranslationMemoryEntries('Truyện A', [{ src: LONG_SRC_1, dst: 'Bản dịch 1' }], driver);
        await clearTranslationMemory(driver);
        expect(driver.dump().size).toBe(0);
    });
});
