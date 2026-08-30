// Tách chương cho PDF dọc tiếng Nhật (kiểu convert từ Syosetu/Kakuyomu bằng các công cụ như
// "ToriiHina no PDF Maker"). Các PDF này KHÔNG có mục lục (outline/bookmark) nên parsePdf gốc
// chỉ gom toàn bộ văn bản làm 1 khối duy nhất. Module này đọc trực tiếp danh sách text-item
// (item.str) mà pdfjs trả về cho từng trang để nhận diện tiêu đề chương dựa trên VỊ TRÍ và
// CẤU TRÚC item, thay vì regex dòng-văn-bản thông thường (không đáng tin cậy với văn bản dọc
// vì các dòng bị nối lại bằng dấu cách khi gộp thành 1 chuỗi trang).
//
// Cấu trúc điển hình của 1 trang (đã kiểm chứng bằng cách chạy pdfjs-dist thật trên 2 file mẫu
// N1443BP.pdf và N7031BS.pdf):
//   item[0]        = số trang chân trang (footer), LUÔN là chữ số nửa rộng (half-width ASCII),
//                     ví dụ "3", "1941" — khác biệt hoàn toàn với số chương (chữ số toàn rộng).
//   item[1..]      = "" (item rỗng, đánh dấu điểm bắt đầu cột chữ dọc) rồi tới nội dung thật.
//   Item đầu tiên có nội dung sau footer, NẾU là 1 trang MỞ ĐẦU chương, sẽ khớp 1 trong 2 dạng:
//     - Dạng A ("bare"): đúng bằng "＃<số toàn rộng>", ví dụ "＃１" — tiêu đề chương nằm ở
//       item kế tiếp có nội dung (ví dụ "死亡、そして復活。").
//     - Dạng B ("colon"): "<số toàn rộng>：<tiêu đề>" gộp chung 1 item, ví dụ "１：巻き込まれて異世界".
//   Các trang KHÔNG mở đầu chương thì item đầu tiên sau footer là văn bản thường (không khớp
//   2 dạng trên) -> toàn bộ trang thuộc về chương đang mở.
//
// Một số chương có thêm trang riêng cho lời tựa/lời bạt (ví dụ "９４：魔王からの提案（後書き）")
// dùng LẠI đúng số chương đó -> được coi là PHẦN TIẾP THEO của cùng chương đó (gộp nội dung),
// không tách thành chương mới, để tránh trùng số chương.

import { cleanGarbageText } from '../text/garbageCleaner';

export interface PdfVerticalChapter {
    title: string;
    startPage: number;
    content: string;
}

const toHalfWidthDigits = (s: string): string =>
    s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

// Dạng A: "＃" hoặc "◇"/"◆" + số toàn rộng, KHÔNG có gì khác trong cùng item (bắt buộc có ký
// hiệu riêng để giảm nguy cơ nhận nhầm 1 con số đơn lẻ xuất hiện tình cờ trong văn bản thường
// thành tiêu đề chương). "◇"/"◆" thường dùng cho phần mở đầu/spinoff phụ (vd "◇000 プロローグ").
const BARE_MARKER_RE = /^([＃◇◆])([０-９]{1,4})$/;
// Dạng B: số toàn rộng + dấu hai chấm (rộng hoặc hẹp) + phần còn lại làm tiêu đề, trong CÙNG 1 item.
// Rủi ro nhận nhầm cao hơn Dạng A (không có ký hiệu riêng bắt buộc) -- vd 1 danh sách liệt kê
// trong truyện kiểu "3：tìm lõi..." "4：phá huỷ lõi..." tình cờ đứng đầu trang cũng khớp mẫu này.
// Được chặn thêm bằng ĐIỀU KIỆN ĐƠN ĐIỆU TĂNG (xem maxColonNumSeen bên dưới) -- số chương thật
// trên các site kiểu Syosetu luôn tăng dần tuần tự, không bao giờ quay lại số nhỏ hơn đã thấy.
const COLON_MARKER_RE = /^([０-９]{1,4})[：:](.+)$/;
// Các từ khoá chương đặc biệt (mở đầu/kết thúc/hậu ký) có thể xuất hiện độc lập làm tiêu đề trang.
const SECTION_WORDS = ['プロローグ', 'エピローグ', 'あとがき', '後書き'];
const SECTION_PREFIXES = ['番外編', '特別編', '外伝', '書き下ろし'];
// Hậu tố dạng "（前書き）"/"（後書き）"/"（あとがき）" đôi khi bị dính vào cùng item tiêu đề của
// trang lời tựa/lời bạt -> cắt bỏ khi hiển thị tên chương cho gọn (không đụng tới nội dung).
const TITLE_NOTE_SUFFIX_RE = /[（(](?:前書き|後書き|あとがき)[）)]\s*$/;

function isSectionWord(s: string): boolean {
    if (SECTION_WORDS.includes(s)) return true;
    return SECTION_PREFIXES.some((p) => s.startsWith(p));
}

function isFooterPageNumber(s: string): boolean {
    // Chỉ số trang chân trang dùng chữ số NỬA RỘNG (half-width ASCII 0-9); số chương dùng chữ
    // số TOÀN RỘNG (fullwidth ０-９) nên 2 loại không bao giờ trùng nhau về mặt ký tự.
    return /^[0-9]{1,4}$/.test(s);
}

interface HeaderMatch {
    num: string | null; // số chương đã quy về nửa rộng, hoặc null nếu là từ khoá đặc biệt
    title: string;
    // Dòng tiêu đề gốc (nguyên trạng, đã ghép số+tiêu đề) để giữ lại làm dòng đầu tiên của nội
    // dung chương -- KHÔNG được bỏ qua khi build content, khác với bản trước đây.
    headerLine: string;
    isColonStyle: boolean; // true nếu khớp Dạng B -- áp thêm điều kiện đơn điệu tăng khi dùng.
}

function matchHeader(items: string[], startIdx: number): { header: HeaderMatch; contentStartIdx: number } | null {
    let i = startIdx;
    while (i < items.length && items[i].trim() === '') i++;
    if (i >= items.length) return null;
    const s = items[i].trim();

    const colonMatch = s.match(COLON_MARKER_RE);
    if (colonMatch) {
        const num = toHalfWidthDigits(colonMatch[1]);
        const title = colonMatch[2].trim();
        return { header: { num, title, headerLine: `${num}：${title}`, isColonStyle: true }, contentStartIdx: i + 1 };
    }

    const bareMatch = s.match(BARE_MARKER_RE);
    if (bareMatch) {
        let j = i + 1;
        while (j < items.length && items[j].trim() === '') j++;
        const title = j < items.length ? items[j].trim() : '';
        const symbol = bareMatch[1];
        const num = toHalfWidthDigits(bareMatch[2]);
        return { header: { num, title, headerLine: title ? `${symbol}${num} ${title}` : `${symbol}${num}`, isColonStyle: false }, contentStartIdx: j + 1 };
    }

    if (isSectionWord(s)) {
        return { header: { num: null, title: s, headerLine: s, isColonStyle: false }, contentStartIdx: i + 1 };
    }

    return null;
}

/**
 * Nhận diện và tách chương từ danh sách item text (item.str) của từng trang PDF dọc tiếng Nhật.
 * @param pageItemsList mảng, mỗi phần tử là danh sách item.str (theo đúng thứ tự pdfjs trả về) của 1 trang, đánh số từ trang 1.
 * @returns danh sách chương đã tách, rỗng nếu không phát hiện được cấu trúc chương phù hợp (PDF không thuộc dạng này).
 */
export function splitJapaneseVerticalPdfByMarkers(pageItemsList: (string[] | undefined)[]): PdfVerticalChapter[] {
    type OpenChapter = { startPage: number; num: string | null; title: string; buf: string[] };
    const finished: PdfVerticalChapter[] = [];
    let current: OpenChapter | null = null;
    // Số chương lớn nhất đã thấy qua Dạng B (colon-style) -- dùng để loại các "khớp" giả xuất
    // hiện tình cờ khi 1 danh sách liệt kê trong truyện ("3：...", "4：...") đứng đầu 1 trang.
    let maxColonNumSeen = -1;

    // Mỗi "item" pdfjs trả về đã tương ứng gần đúng với 1 dòng chữ dọc thực tế (do PDF gốc vẽ
    // mỗi dòng bằng 1 lệnh Tj riêng) -> nối bằng \n thay vì khoảng trắng để giữ được ranh giới
    // dòng/thoại thay vì gộp cả chương thành 1 dòng liền không xuống dòng.
    const pushItems = (buf: string[], items: string[], from: number) => {
        for (let k = from; k < items.length; k++) {
            const t = items[k];
            if (t.trim() === '') continue;
            buf.push(t);
        }
    };

    for (let p = 1; p < pageItemsList.length; p++) {
        const items = pageItemsList[p];
        if (!items || items.length === 0) continue;

        let startIdx = 0;
        if (isFooterPageNumber(items[0].trim())) startIdx = 1;

        let matched = matchHeader(items, startIdx);
        if (matched && matched.header.isColonStyle && matched.header.num !== null) {
            const n = parseInt(matched.header.num, 10);
            if (n < maxColonNumSeen) {
                // Số nhỏ hơn số chương colon-style lớn nhất đã thấy -> gần như chắc chắn là 1
                // danh sách liệt kê trong nội dung, không phải tiêu đề chương thật. Bỏ qua, coi
                // như nội dung thường của chương đang mở.
                matched = null;
            } else {
                maxColonNumSeen = n;
            }
        }

        if (matched && current && matched.header.num !== null && matched.header.num === current.num) {
            // Trang tiếp theo của CÙNG chương (vd: trang lời tựa/lời bạt) -> gộp nội dung, không tách mới.
            let i = startIdx;
            while (i < items.length && items[i].trim() === '') i++;
            pushItems(current.buf, items, i);
        } else if (matched) {
            if (current) finished.push({ title: current.title, startPage: current.startPage, content: cleanGarbageText(current.buf.join('\n').trim()) });
            // Giữ nguyên dòng tiêu đề (số chương + tên chương) làm DÒNG ĐẦU TIÊN của nội dung
            // chương, giống hành vi tool tham khảo -- trước đây bị bỏ qua khiến mất tiêu đề.
            const buf: string[] = [matched.header.headerLine, ''];
            pushItems(buf, items, matched.contentStartIdx);
            current = { startPage: p, num: matched.header.num, title: matched.header.title.replace(TITLE_NOTE_SUFFIX_RE, '').trim() || matched.header.title, buf };
        } else if (current) {
            pushItems(current.buf, items, startIdx);
        }
        // Nếu chưa có chương nào mở (còn ở phần trang bìa/giới thiệu tác phẩm) thì bỏ qua nội dung trang này.
    }
    if (current) finished.push({ title: current.title, startPage: current.startPage, content: cleanGarbageText(current.buf.join('\n').trim()) });

    return finished.filter((c) => c.content.length > 0);
}
