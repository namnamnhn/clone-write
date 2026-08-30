// Các tiện ích file/tên/sắp xếp cơ bản, không phụ thuộc JSZip/pdfjs (public API).
import { FileItem, FileStatus } from '../../types';
import { padNumber } from './shared';
import { countForeignChars } from '../text/analysis';

// FIX (fix21 - bug "24 file bị đếm nhầm vào diện cứu hộ vệ tinh"): dọn lại cờ `isRescueLocked`
// bị TREO OAN trên các file đã thực sự dịch xong. Trong toàn bộ codebase, CHỈ có đúng 1 nơi set
// `isRescueLocked: true` (runStartupTriage trong useTranslator.ts), và luôn đi kèm
// `status: ERROR`. Nếu 1 file sau đó được dịch lại thành công (status chuyển thành COMPLETED) ở
// một phiên bản app CŨ HƠN - trước khi dòng code tự gỡ khoá lúc COMPLETED (useTranslator.ts, khối
// xử lý kết quả dịch) tồn tại - cờ `isRescueLocked` bị kẹt lại `true` vĩnh viễn trong dữ liệu đã
// lưu, dù nội dung đã dịch xong hoàn toàn. COMPLETED + isRescueLocked=true là 2 trạng thái MÂU
// THUẪN nhau (không có ý nghĩa gì - file đã xong thì không thể vừa "đang chờ cứu hộ"), nhưng
// KHÔNG có bước nào tự rà soát lại điều này mỗi khi mở lại dữ liệu cũ (mọi chỗ gỡ khoá hiện tại
// chỉ chạy theo SỰ KIỆN chuyển trạng thái, không có bước "rà soát khi load"), khiến Dashboard/bộ
// đếm "cứu hộ" (rescueLockedCount) bị cộng nhầm các file đã xong việc từ lâu. Hàm này chỉ sửa
// ĐÚNG 1 trường hợp mâu thuẫn rõ ràng đó (an toàn, không đụng tới các file IDLE/ERROR đang thực sự
// chờ xử lý) - dùng ở cả 2 nơi dữ liệu file được nạp vào state: tải từ IndexedDB lúc mở app
// (useCoreState.ts) và khôi phục từ file Backup .json (fileBackupRestore.ts).
// FIX (fix55 - bug "phân tích sâu chia 2 phần bị nửa nạc nửa mỡ so với phân tích 1 lần"):
// Trước đây mọi nơi gộp nhiều chương lại để gửi AI theo từng đợt (phân tích ngữ cảnh, sửa lỗi,
// quét Hán Việt...) đều nối hết nội dung các file thành 1 chuỗi dài rồi cắt CỨNG theo số ký tự
// (String.substring(i, i+CHUNK_SIZE)). Cách này có thể cắt ngay giữa 1 chương, thậm chí giữa 1
// cảnh/đoạn hội thoại đang diễn ra, khiến AI phân tích/sửa lỗi thiếu ngữ cảnh ngay tại điểm cắt,
// và tệ hơn là 1 chương có thể bị xé làm đôi, nửa đầu rơi vào batch này, nửa sau rơi vào batch
// khác — 2 batch xử lý song song/độc lập nên không "nhìn thấy nhau", kết quả phân tích 1 chương
// bị rời rạc. Hàm này gộp theo ĐƠN VỊ FILE (chương): chỉ chuyển sang chunk mới ở ranh giới GIỮA
// 2 file, không bao giờ cắt ngang thân 1 file trừ khi bản thân file đó đã vượt quá giới hạn 1
// chunk (hiếm, chương siêu dài) — khi đó mới bất đắc dĩ cắt trong nội bộ file, và ưu tiên cắt tại
// ranh giới đoạn văn (xuống dòng kép) rồi mới tới ranh giới dòng, tránh cắt giữa dòng/giữa câu.
export function chunkTextByFileBoundary(items: { text: string }[], maxChunkSize: number): string[] {
    const chunks: string[] = [];
    let current: string[] = [];
    let currentLen = 0;

    const flush = () => {
        if (current.length > 0) {
            chunks.push(current.join('\n'));
            current = [];
            currentLen = 0;
        }
    };

    for (const item of items) {
        const text = item.text || '';
        if (!text) continue;

        if (text.length > maxChunkSize) {
            // 1 file đơn lẻ đã lớn hơn cả giới hạn chunk: đóng chunk hiện tại lại (không trộn
            // file khổng lồ này với các file khác), rồi cắt riêng nó theo ranh giới đoạn
            // văn/dòng — an toàn hơn nhiều so với cắt cứng theo ký tự.
            flush();
            let idx = 0;
            while (idx < text.length) {
                let end = Math.min(idx + maxChunkSize, text.length);
                if (end < text.length) {
                    let safeEnd = text.lastIndexOf('\n\n', end);
                    if (safeEnd <= idx) safeEnd = text.lastIndexOf('\n', end);
                    if (safeEnd > idx) end = safeEnd;
                }
                chunks.push(text.slice(idx, end));
                idx = end;
                // Bỏ qua các ký tự xuống dòng ngay tại điểm cắt để chunk tiếp theo không bị dính
                // "\n\n" thừa ở đầu (đã dùng chính "\n\n" đó làm ranh giới tách ở trên).
                while (idx < text.length && text[idx] === '\n') idx++;
            }
            continue;
        }

        if (currentLen + text.length > maxChunkSize && current.length > 0) {
            flush();
        }
        current.push(text);
        currentLen += text.length;
    }
    flush();
    return chunks;
}

export const reconcileStaleRescueLocks = (files: FileItem[]): FileItem[] => {
    let changed = false;
    const result = files.map(f => {
        if (f.isRescueLocked && f.status === FileStatus.COMPLETED) {
            changed = true;
            return { ...f, isRescueLocked: false };
        }
        return f;
    });
    return changed ? result : files;
};

// FIX (fix56 - bug "app bê nguyên tất cả raw ở file gốc lên [badge 'Sót Raw']"): nhiều nơi tạo/
// nhập file (import, tách chương, dán nội dung...) từng gán `remainingRawCharCount` bằng thẳng
// `.length` của một chuỗi RAW (nguyên văn, kể cả dấu câu/khoảng trắng) thay vì đếm đúng số ký tự
// CJK/Kana/Hangul/Cyrillic/Thái còn sót bằng `countForeignChars` — dữ liệu sai này có thể "kẹt lại"
// qua nhiều phiên làm việc (lưu vào IndexedDB rồi tải lại, hoặc qua Backup/Restore) vì 1 khi file
// đã ở trạng thái COMPLETED và không bị dịch lại, không có bước nào tự tính lại số này nữa — badge
// "Sót N Raw" hiển thị N gần bằng NGUYÊN VĂN độ dài file gốc dù bản dịch thực tế đã sạch. Hàm này
// (gọi ở cả 2 điểm NẠP dữ liệu: mở lại phiên từ IndexedDB và Khôi Phục Backup — xem
// reconcileStaleRescueLocks() ở trên) tự tính lại đúng `remainingRawCharCount` cho MỌI file
// COMPLETED có `translatedContent`, tự sửa mọi giá trị sai còn sót từ trước, không cần người dùng
// tự dịch lại từng file mới hết badge oan.
export const reconcileStaleRawCount = (files: FileItem[]): FileItem[] => {
    let changed = false;
    const result = files.map(f => {
        if (f.status === FileStatus.COMPLETED && f.translatedContent) {
            const correctCount = countForeignChars(f.translatedContent);
            if (f.remainingRawCharCount !== correctCount) {
                changed = true;
                return { ...f, remainingRawCharCount: correctCount };
            }
        }
        return f;
    });
    return changed ? result : files;
};

export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};

export const base64ToFile = (base64: string, filename: string): File => {
    try {
        const arr = base64.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        return new File([u8arr], filename, { type: mime });
    } catch (e) {
        console.error("Lỗi chuyển đổi ảnh từ backup:", e);
        return new File([""], "error.png", { type: "image/png" });
    }
};

export const generateExportFileName = (title: string, author: string, extension: string = ""): string => {
    const safeTitle = title ? title.trim() : "Truyen_Moi";
    const safeAuthor = author ? author.trim() : "";
    let baseName = safeAuthor ? `${safeTitle}_${safeAuthor}` : safeTitle;
    baseName = baseName.replace(/[\\/:*?"<>|]/g, "").trim();
    if (!baseName) baseName = "Exported_Story";
    return extension ? `${baseName}${extension}` : baseName;
};

export const renumberFiles = (files: FileItem[], startIndex: number): FileItem[] => {
    return files.map((file, index) => {
        const currentIndex = startIndex + index;
        const paddedIndex = padNumber(currentIndex);
        const cleanName = file.name.replace(/^\d{5}\s+/, '');
        return { ...file, name: `${paddedIndex} ${cleanName}` };
    });
};

export const sortFiles = (list: FileItem[]) => { 
    const re = /(\d+)/; 
    return [...list].sort((a, b) => { 
        const aParts = a.name.split(re); 
        const bParts = b.name.split(re); 
        const len = Math.min(aParts.length, bParts.length); 
        for (let i = 0; i < len; i++) { 
            const aPart = aParts[i]; 
            const bPart = bParts[i]; 
            if (aPart === bPart) continue; 
            const aNum = parseInt(aPart, 10); 
            const bNum = parseInt(bPart, 10); 
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum; 
            return aPart.localeCompare(bPart); 
        } 
        return aParts.length - bParts.length; 
    }); 
};

export const getSmartSampledFiles = (files: FileItem[], sampling: { start: number, middle: number, end: number }): FileItem[] => {
    const sortedFiles = sortFiles([...files]);
    const totalFiles = sortedFiles.length;
    const requiredTotal = sampling.start + sampling.middle + sampling.end;
    
    if (totalFiles <= requiredTotal) {
        return sortedFiles;
    }

    const startBatch = sortedFiles.slice(0, sampling.start);
    const endBatch = sortedFiles.slice(-sampling.end);
    
    const midIndex = Math.floor(totalFiles / 2);
    const midStart = Math.max(sampling.start, midIndex - Math.floor(sampling.middle / 2));
    const midEnd = Math.min(totalFiles - sampling.end, midStart + sampling.middle);
    const middleBatch = sortedFiles.slice(midStart, midEnd);
    
    const uniqueMap = new Map<string, FileItem>();
    [...startBatch, ...middleBatch, ...endBatch].forEach(f => uniqueMap.set(f.id, f));
    
    return Array.from(uniqueMap.values()).sort((a, b) => {
        // Re-sort to ensure order
        const idxA = sortedFiles.findIndex(f => f.id === a.id);
        const idxB = sortedFiles.findIndex(f => f.id === b.id);
        return idxA - idxB;
    });
};

export const parseFilenameMetadata = (filename: string): { title: string, author: string } => {
    let cleanName = filename.replace(/\.(epub|zip|docx|doc|txt|rar|pdf|xhtml|html|xml)$/i, '');
    cleanName = cleanName.replace(/\s*\(\d+\)$/, '');
    const suffixRegex = /([_\-\s]+(part|tap|tập|quyen|quyển|vol|book|phan|phần|chuong|chương)[_\-\s]*\d+.*$)|([_\-\s]+(full|prc|epub|mobi|azw3|text|convert|vp|vpro).*$)/i;
    cleanName = cleanName.replace(suffixRegex, '');
    cleanName = cleanName.trim();
    let title = cleanName;
    let author = "";
    if (cleanName.includes('_')) {
        const parts = cleanName.split('_');
        if (parts.length >= 2) {
            author = parts.pop()?.trim() || "";
            title = parts.join(' ').trim();
        }
    } else if (cleanName.includes(' - ')) {
        const parts = cleanName.split(' - ');
        if (parts.length >= 2) {
            author = parts.pop()?.trim() || "";
            title = parts.join(' - ').trim();
        }
    }
    title = title.replace(/_/g, ' ').trim();
    author = author.replace(/_/g, ' ').trim();
    return { title, author };
};

export const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (!buffer) { resolve(""); return; }
      
      try {
        // Mặc định thử giải mã utf-8 trước, bật fatal để ném lỗi nếu không phải utf-8
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        resolve(utf8Decoder.decode(buffer));
        return;
      } catch {
        // Nếu không phải utf-8, thử các bảng mã truyện thông dụng (Trung, Hàn, Nhật...)
        const candidates = ['gb18030', 'big5', 'euc-kr', 'shift_jis', 'windows-1252'];
        for (const enc of candidates) {
          try {
            const decoder = new TextDecoder(enc, { fatal: true });
            resolve(decoder.decode(buffer));
            return;
          } catch { continue; }
        }
        // Fallback cuối nếu tất cả thất bại (thường là gbk/gb18030 cho truyện Trung)
        const fallbackDecoder = new TextDecoder('utf-8');
        resolve(fallbackDecoder.decode(buffer));
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
  });
};
