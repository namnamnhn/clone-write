import { FileItem, FileStatus } from "../../types";
import { countForeignChars } from "./analysis";

export const splitLargeChapter = (file: FileItem, maxChars: number = 10000, numParts?: number): FileItem[] => {
    if (!file.content || file.content.length <= maxChars) {
        return [file];
    }

    const lines = file.content.split('\n');
    let titleLine = lines[0].trim() !== "" ? lines[0] : "";
    let startIndex = titleLine ? 1 : 0;
    
    // Sometimes title is on the second line
    if (!titleLine && lines.length > 1 && lines[1].trim() !== "") {
        titleLine = lines[1].trim();
        startIndex = 2;
    }

    // Try to find the title inside the content if the first few lines are empty
    if (!titleLine) {
        for(let i=0; i<Math.min(10, lines.length); i++) {
             if(lines[i].trim() !== "") {
                  titleLine = lines[i].trim();
                  startIndex = i + 1;
                  break;
             }
        }
    }

    const titlePrefix = file.name || "Chương";

    // Collect non-empty body lines (paragraphs will be rejoined with "\n\n")
    const bodyLines = lines.slice(startIndex).map(l => l.trim()).filter(l => l.length > 0);

    const parts: string[] = [];

    if (bodyLines.length === 0) {
        return [file];
    }

    // Cumulative length of the body if joined with "\n\n" (2 chars) between paragraphs
    const cumLength: number[] = [];
    let acc = 0;
    bodyLines.forEach((line, idx) => {
        acc += line.length + (idx > 0 ? 2 : 0);
        cumLength.push(acc);
    });
    const totalBodyLength = cumLength[cumLength.length - 1];

    // Nếu người dùng chỉ định rõ số phần muốn chia (numParts), dùng đúng số đó.
    // Ngược lại, tự tính số phần dựa trên ngưỡng (maxChars) sao cho mỗi phần
    // không vượt quá ngưỡng, rồi chia đều theo độ dài tích lũy thay vì nhồi
    // đầy từng phần rồi để phần cuối là phần dư (có thể rất ngắn).
    let targetParts: number;
    if (numParts && numParts >= 2) {
        targetParts = Math.min(Math.floor(numParts), bodyLines.length);
    } else {
        targetParts = Math.max(1, Math.ceil(totalBodyLength / maxChars));
        // Đảm bảo mỗi phần trung bình không vượt quá maxChars
        while (targetParts > 1 && Math.ceil(totalBodyLength / targetParts) > maxChars) {
            targetParts += 1;
        }
    }

    const idealSize = totalBodyLength / targetParts;
    const cutIndices: number[] = [];
    let nextThreshold = 1;

    for (let i = 0; i < bodyLines.length; i++) {
        if (nextThreshold < targetParts && cumLength[i] >= idealSize * nextThreshold) {
            cutIndices.push(i);
            nextThreshold += 1;
        }
    }
    cutIndices.push(bodyLines.length - 1); // last part always ends at the last line

    // Build [startLine, endLine] boundaries for each segment
    const segments: [number, number][] = [];
    let startLine = 0;
    for (const endLine of cutIndices) {
        if (endLine < startLine) continue; // safety guard against degenerate cuts
        segments.push([startLine, endLine]);
        startLine = endLine + 1;
    }

    // Merge any segment that ended up disproportionately tiny (e.g. a lone short
    // paragraph left dangling at the very end) into its neighbor, so we never
    // emit a file with only a handful of characters.
    const minSegmentChars = Math.min(idealSize * 0.25, maxChars * 0.25);
    for (let i = segments.length - 1; i > 0; i--) {
        const [s, e] = segments[i];
        const segLen = cumLength[e] - (s > 0 ? cumLength[s - 1] : 0);
        if (segLen < minSegmentChars) {
            // fold this tiny segment into the previous one
            segments[i - 1][1] = e;
            segments.splice(i, 1);
        }
    }

    for (const [s, e] of segments) {
        const partLines = bodyLines.slice(s, e + 1);
        parts.push(partLines.join("\n\n"));
    }
    
    const splitFiles: FileItem[] = parts.map((partContent, index) => {
        const partNumber = index + 1;
        const newTitle = titleLine ? `${titleLine} (${partNumber})` : `${titlePrefix} (${partNumber})`;
        // FIX (bug "Gộp File không ghép chuẩn các file bị tách chương nữa"): trước đây suffix
        // " (N)" bị nối vào SAU CÙNG file.name, kể cả khi file.name đã có sẵn phần mở rộng
        // (vd "Chương 1.txt" -> "Chương 1.txt (1)") — extension nằm GIỮA tên, không còn ở cuối.
        // chapterMerger.ts (detectSplitChapterGroup/parseSplitPartName) lấy "extension" bằng
        // cách tách theo dấu chấm CUỐI CÙNG trong tên file: với "Chương 1.txt (1)", nó lấy
        // nhầm "txt (1)" làm phần mở rộng rồi cắt bỏ luôn CẢ phần mở rộng thật lẫn hậu tố " (1)"
        // trong 1 lần replace — kết quả chỉ còn "Chương 1", không còn khớp định dạng "<base> (N)"
        // nữa -> bị coi là không phải file tách chương -> "Gộp File" không nhận diện được nhóm
        // này để ghép lại. SỬA: chèn " (N)" NGAY TRƯỚC phần mở rộng (nếu có), giữ đúng định dạng
        // "<base> (N).<ext>" mà chapterMerger.ts kỳ vọng (tương tự cách mergeSplitChapterGroup()
        // dựng lại tên file khi ghép — xem chapterMerger.ts).
        const nameExtension = file.name.includes('.') ? file.name.split('.').pop() : undefined;
        const nameBaseNoExt = nameExtension ? file.name.slice(0, -(nameExtension.length + 1)) : file.name;
        const newFileName = nameExtension ? `${nameBaseNoExt} (${partNumber}).${nameExtension}` : `${file.name} (${partNumber})`;
        
        const fullContent = `${newTitle}\n\n${partContent}`;
        
        const isTranslatedImportMatch = file.translatedContent !== null && file.content.trim() === file.translatedContent.trim();
        
        return {
            ...file,
            id: crypto.randomUUID(),
            name: newFileName,
            content: fullContent,
            translatedContent: isTranslatedImportMatch ? fullContent : null,
            status: isTranslatedImportMatch ? FileStatus.COMPLETED : FileStatus.IDLE,
            retryCount: 0,
            originalCharCount: fullContent.length,
            // FIX: dùng đúng ngữ nghĩa chung của hệ thống ("số ký tự raw/CJK còn sót") như
            // chapterMerger/splitters - trước đây gán fullContent.length (tổng độ dài) khiến
            // mọi file vừa tách ra mang giá trị "còn sót raw" bằng toàn bộ nội dung.
            remainingRawCharCount: isTranslatedImportMatch ? 0 : countForeignChars(fullContent),
            // FIX (bug "file đã dịch xong vẫn bị xếp vào diện cứu hộ"): `...file` phía trên có thể
            // mang theo `isRescueLocked: true` từ file gốc trước khi tách - khi phần tách ra được
            // coi là COMPLETED (đã có bản dịch khớp), cờ khoá cũ không nên dính lại mù quáng.
            isRescueLocked: isTranslatedImportMatch ? false : file.isRescueLocked,
            // FIX (cờ "bản dịch nghi vấn" nói dối): phần tách ra KHÔNG có bản dịch
            // (!isTranslatedImportMatch -> translatedContent: null) nhưng vẫn kế thừa
            // hasStaleTranslation: true của file gốc qua spread — vi phạm hợp đồng trong types.ts
            // ("cờ này chỉ đi kèm translatedContent đang bị giữ lại để xem xét"). Reset về false
            // cho phần chưa dịch; phần COMPLETED thì bản dịch là khớp nguyên văn, cũng không còn
            // gì là "nghi vấn".
            hasStaleTranslation: false,
        };
    });

    return splitFiles;
};
