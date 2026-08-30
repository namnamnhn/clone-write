// Hàm định dạng chính cho văn bản đã dịch: chuẩn hóa tiêu đề chương, dấu ngoặc/trích dẫn,
// khoảng trắng, sửa các lỗi convert/dịch phổ biến (từ lóng, số bị AI đọc nhầm...).
// LƯU Ý: Đây là 1 hàm dài (~400 dòng) với nhiều bước .replace() nối tiếp nhau CÓ THỨ TỰ
// phụ thuộc lẫn nhau — cố tình KHÔNG tách nhỏ nội dung hàm ra để tránh phá vỡ thứ tự xử lý
// (rủi ro cao, cần bộ test riêng mới nên làm). Việc tách file này chỉ nhằm mục đích khoanh
// vùng: khi cần sửa lỗi định dạng, chỉ cần mở đúng 1 file nhỏ này thay vì file 600 dòng cũ.
import { toTitleCase } from './textCase';

export const formatBookStyle = (
  text: string,
  rawText?: string,
  enableTitleFormatting: boolean = true,
  titleFormat: 'colon' | 'dash' | 'newline' | 'bracket' = 'colon',
  enableAutoFormat: boolean = true
): string => {
  if (!text) return text;

  let formatted = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  // Remove __TITLE_ANCHOR__ tags before applying any parsing
  formatted = formatted.replace(/^__TITLE_ANCHOR__:[ \t]*/gim, "");

  // PRE-PROCESSING: Find and remove erroneous standalone chapter lines directly after a valid chapter title.
  const preLines = formatted.split("\n");
  const preFinalLines = [];
  let foundPreMainTitle = false;
  let preMainTitleIndex = -1;

  for (let i = 0; i < preLines.length; i++) {
    const line = preLines[i];
    if (line.trim().length === 0) {
      preFinalLines.push(line);
      continue;
    }

    const isChapterTitleMatch =
      /^(?:[\s*#\[\]]*)(?:Chương|Ngoại\s*chương|Phụ\s*chương|Phiên\s*ngoại|Tiết|Hồi|Phần|Quyển|Tập)\s+\d+/i.test(
        line.trim(),
      );

    if (isChapterTitleMatch) {
      if (!foundPreMainTitle) {
        foundPreMainTitle = true;
        preMainTitleIndex = preFinalLines.length;
        preFinalLines.push(line);
      } else {
        // If it's literally just "Chương X" without any alphabetic letters (title)
        const isJustChapterNumber =
          /^(?:[\s*#\[\]]*)(?:Chương|Ngoại\s*chương|Phụ\s*chương|Phiên\s*ngoại|Tiết|Hồi|Phần|Quyển|Tập)\s+\d+[\s*#\[\]:.\-]*$/i.test(
            line.trim(),
          );

        // Count how many text lines we have seen since main title
        let linesSinceTitle = 0;
        for (let j = preMainTitleIndex + 1; j < preFinalLines.length; j++) {
          if (preFinalLines[j].trim().length > 0) linesSinceTitle++;
        }

        if (isJustChapterNumber && linesSinceTitle < 5) {
          continue; // Skip erroneous hallucinated chapter number line
        }
        preFinalLines.push(line);
      }
    } else {
      preFinalLines.push(line);
    }
  }
  formatted = preFinalLines.join("\n");

  if (enableTitleFormatting !== false) {
    // Clean up junk before the first title to ensure the title is at the very beginning.
    // FIX (đề xuất phát sinh trong lúc soát fix29): trước đây bắt buộc \d+ ngay sau MỌI từ
    // khóa, kể cả 3 loại chương phụ "Ngoại chương/Phụ chương/Phiên ngoại" (đúng 3 loại được
    // Mục VIII cho phép không đánh số) — nên nếu chương phụ không số nằm ngay sau rác đầu file,
    // rác đó không bị nhận diện/xoá. Tách alternation: Chương/Tiết/Hồi/Phần/Quyển/Tập vẫn bắt
    // buộc \d+ (luôn có số, giữ nguyên rủi ro thấp); 3 từ khóa phụ cho \d+ TÙY CHỌN, đồng bộ
    // với specialNoNumRegex bên dưới.
    const firstTitleMatch = formatted.match(/^(?:[\s*#\[\]]*)(?:(?:Chương|Tiết|Hồi|Phần|Quyển|Tập)[\s*]+\d+|(?:Ngoại(?:[\s*]+)chương|Phụ(?:[\s*]+)chương|Phiên(?:[\s*]+)ngoại)(?:[\s*]+\d+)?)/mi);
    if (firstTitleMatch && firstTitleMatch.index !== undefined && firstTitleMatch.index > 0) {
      const junkBefore = formatted.substring(0, firstTitleMatch.index);
      // Only remove if it's relatively short (less than 150 chars) or just whitespace/punctuation
      if (junkBefore.length < 150 || /^[\s\W_]+$/.test(junkBefore)) {
         formatted = formatted.substring(firstTitleMatch.index);
      }
    }

    // Clean up scraper index prefixes like "247. Chương 234" -> "Chương 234"
    // Cùng fix như trên: 3 từ khóa chương phụ cho số theo sau TÙY CHỌN trong lookahead.
    formatted = formatted.replace(/^[ \t]*\d+[ \t*#\[\]:.\-]+(?=(?:(?:Chương|Tiết|Hồi|Phần|Quyển|Tập)[ \t]+\d+|(?:Ngoại[ \t]*chương|Phụ[ \t]*chương|Phiên[ \t]*ngoại)(?:[ \t]+\d+)?))/gim, "");

    // Title formatting - Pattern 1: Chương 1: Tiêu đề
    const titleRegex =
      /^([ \t*#\[\]]*(?:.*?[ \t]*[\-:][ \t]*(?=.*?(?:Chương|Ngoại[ \t]*chương|Phụ[ \t]*chương|Phiên[ \t]*ngoại|Tiết|Hồi|Phần|Quyển|Tập)[ \t]+\d+))?)?(Chương|Ngoại[ \t]*chương|Phụ[ \t]*chương|Phiên[ \t]*ngoại|Tiết|Hồi|Phần|Quyển|Tập)[ \t]+(\d+)[ \t*#\[\]:.\-]*[ \t]*(.*?)(?=\n|$)/gim;
    formatted = formatted.replace(titleRegex, (match, prefix, p1, p2, p3) => {
      let title = p3.replace(/[*#\[\]]/g, "").trim();
      const safePrefix = prefix ? prefix.replace(/[*#\[\]]/g, "").trim() : "";

      if (title.length > 150) {
        // If the title is too long, it's likely a merged paragraph. Don't Title Case the whole thing.
        title = title ? `${title.charAt(0).toUpperCase() + title.slice(1)}` : "";
      } else if (title) {
        const upperCount = (title.match(/\p{Lu}/gu) || []).length;
        const letterCount = (title.match(/\p{L}/gu) || []).length;
        if (letterCount > 5 && upperCount / letterCount > 0.7) {
          title = toTitleCase(title.toLowerCase());
        } else {
          title = toTitleCase(title);
        }
      }

      // Preserve the prefix strictly (e.g. 'Tập 1 - ')
      const parsedP1 = p1 ? toTitleCase(p1) : "Chương";
      const basePrefix = safePrefix ? `${toTitleCase(safePrefix)} ${parsedP1} ${p2}`.replace(/\s+/g, ' ') : `${parsedP1} ${p2}`;
      
      switch (titleFormat) {
          case 'dash':
              return title ? `${basePrefix} — ${title}` : basePrefix;
          case 'newline':
              return title ? `${basePrefix}\n${title}` : basePrefix;
          case 'bracket':
              return title ? `[${basePrefix}]: ${title}` : `[${basePrefix}]`;
          case 'colon':
          default:
              return title ? `${basePrefix}: ${title}` : basePrefix;
      }
    });

    // FIX (tiêu đề "Ngoại chương/Phụ chương/Phiên ngoại" KHÔNG đánh số bị kẹt nguyên "**...**"):
    // titleRegex ở trên BẮT BUỘC phải có \d+ ngay sau từ khóa mới khớp. 3 loại chương đặc biệt
    // này (theo đúng định dạng AI được yêu cầu ở Mục VIII prompts/translation.ts) đôi khi KHÔNG
    // có số phía sau (vd "**Phiên ngoại: Kết thúc câu chuyện**" khi raw gốc không đánh số ngoại
    // truyện) — những dòng này bị titleRegex bỏ qua, giữ nguyên cặp "**...**" bọc ngoài, khiến
    // bước bảo vệ markdown phía dưới coi đó là in đậm hợp lệ và giữ lại tới tận file EPUB, làm
    // dòng tiêu đề không được nhận diện là h2 (xem isChapterTitle trong exporters.ts) mà rơi
    // xuống thành đoạn văn thường. Xử lý riêng, CHỈ cho 3 từ khóa này (không đụng tới Chương/Hồi/
    // Quyển/Phần/Tiết/Tập vì các chương chính luôn có số, mở rộng thêm cho nhóm đó rủi ro cao hơn
    // lợi ích), và CHỈ khi KHÔNG có số theo sau (negative lookahead \d) để không xử lý trùng lặp
    // lên các dòng titleRegex ở trên đã xử lý xong.
    const specialNoNumRegex =
      /^([ \t*#\[\]]*(?:.*?[ \t]*[\-:][ \t]*(?=.*?(?:Ngoại[ \t]*chương|Phụ[ \t]*chương|Phiên[ \t]*ngoại)))?)?(Ngoại[ \t]*chương|Phụ[ \t]*chương|Phiên[ \t]*ngoại)(?!\s*\d)[ \t*#\[\]:.\-]*[ \t]*(.*?)(?=\n|$)/gim;
    formatted = formatted.replace(specialNoNumRegex, (match, prefix, p1, p3) => {
      let title = p3.replace(/[*#\[\]]/g, "").trim();
      const safePrefix = prefix ? prefix.replace(/[*#\[\]]/g, "").trim() : "";

      if (title.length > 150) {
        title = title ? `${title.charAt(0).toUpperCase() + title.slice(1)}` : "";
      } else if (title) {
        const upperCount = (title.match(/\p{Lu}/gu) || []).length;
        const letterCount = (title.match(/\p{L}/gu) || []).length;
        if (letterCount > 5 && upperCount / letterCount > 0.7) {
          title = toTitleCase(title.toLowerCase());
        } else {
          title = toTitleCase(title);
        }
      }

      const parsedP1 = toTitleCase(p1.replace(/[ \t]+/g, ' '));
      const basePrefix = safePrefix ? `${toTitleCase(safePrefix)} ${parsedP1}`.replace(/\s+/g, ' ') : parsedP1;

      switch (titleFormat) {
          case 'dash':
              return title ? `${basePrefix} — ${title}` : basePrefix;
          case 'newline':
              return title ? `${basePrefix}\n${title}` : basePrefix;
          case 'bracket':
              return title ? `[${basePrefix}]: ${title}` : `[${basePrefix}]`;
          case 'colon':
          default:
              return title ? `${basePrefix}: ${title}` : basePrefix;
      }
    });

    // Title formatting - Pattern 2: 1: Tiêu đề -> Chương 1: Tiêu đề
    const numTitleRegex = /^[ \t*#\[\]]*(\d+)[ \t*#\[\]:.\-]+[ \t]*(.*?)(?=\n|$)/gim;
    formatted = formatted.replace(numTitleRegex, (match, p1, p2, offset) => {
      const isFirstLine =
        offset === 0 || formatted.substring(0, offset).trim() === "";

      // ONLY apply number-only title formatting if it's the first line of the file.
      // This prevents "9:00AM" or "400 năm sau" in the middle of the text from becoming "Chương 9: 00AM".
      if (!isFirstLine) return match;

      // Prevent formatting times like 9:00AM
      if (/^\d/.test(p2.trim())) return match;

      if (rawText) {
        const firstRawLine = rawText.trim().split("\n")[0] || "";
        // Require explicit chapter indicator in raw text OR it's very short.
        const rawStartsValid = /^(?:[\s*#\[\]]*(?:.*?[-:][ \t]*)?)(?:Chương|Ngoại|Phụ|Phiên|Tiết|Hồi|Phần|Quyển|Tập|第|[一二三四五六七八九十百千万]+\s*章)/i.test(firstRawLine);
        // If it doesn't clearly start with a chapter keyword, only proceed if the raw line is very short (likely a title)
        if (!rawStartsValid && firstRawLine.length > 20) {
          return match;
        }
      }

      let title = p2.replace(/[*#\[\]]/g, "").trim();

      if (title.length > 150) {
        title = title.charAt(0).toUpperCase() + title.slice(1);
      } else if (title) {
        const upperCount = (title.match(/\p{Lu}/gu) || []).length;
        const letterCount = (title.match(/\p{L}/gu) || []).length;
        if (letterCount > 5 && upperCount / letterCount > 0.7) {
          title = toTitleCase(title.toLowerCase());
        } else {
          title = toTitleCase(title);
        }
      }

      const basePrefix = `Chương ${p1}`;
      switch (titleFormat) {
          case 'dash':
              return title ? `${basePrefix} — ${title}` : basePrefix;
          case 'newline':
              return title ? `${basePrefix}\n${title}` : basePrefix;
          case 'bracket':
              return title ? `[${basePrefix}]: ${title}` : `[${basePrefix}]`;
          case 'colon':
          default:
              return title ? `${basePrefix}: ${title}` : basePrefix;
      }
    });
  } else {
    // If Title Formatting is OFF, we aggressively prevent AI hallucinations where it merges the content into the title line
    const aggressiveSplitRegex = /^([ \t*#\[\]]*(?:.*?[ \t]*[\-:][ \t]*(?=.*?(?:Chương|Ngoại|Phụ|Phiên|Tiết|Hồi|Phần|Quyển|Tập)[ \t]+\d+))?)?(Chương|Ngoại[ \t]*chương|Phụ[ \t]*chương|Phiên[ \t]*ngoại|Tiết|Hồi|Phần|Quyển|Tập)[ \t]+(\d+)[ \t*#\[\]:.\-]*[ \t]+([A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ].*?)(?=\n|$)/gim;
    formatted = formatted.replace(aggressiveSplitRegex, (match, prefix, p1, p2, p3) => {
      // If it has substantial text that starts with a capital letter right after the chapter number...
      if (p3 && p3.trim().length > 10) {
        const t = prefix ? `${prefix}${p1} ${p2}` : `${p1} ${p2}`;
        return `${t}\n\n${p3.trim()}`;
      }
      return match;
    });
  }

  if (enableAutoFormat === false) { return formatted; }

  // Bracket and quote normalization (Typographics and Standard VN formats)
  // FIX: chỉ ghép cặp nháy đơn khi dấu ' không kẹt GIỮA các ký tự chữ/số (apostrophe kiểu
  // "Jack's knife hit Jill's arm" trước đây bị nuốt thành "Jack“s knife hit Jill”s arm").
  // Dùng lazy quantifier để ưu tiên cặp GẦN nhất thay vì ghép từ dấu đầu tới dấu cuối dòng.
  formatted = formatted.replace(/(?<![\p{L}\p{N}])'([^']*?)'(?![\p{L}\p{N}])/gu, '“$1”');
  formatted = formatted.replace(/"([^"]*?)"/g, '“$1”');
  formatted = formatted.replace(/‘/g, '“').replace(/’/g, '”')
                       .replace(/「/g, '“').replace(/」/g, '”')
                       .replace(/『/g, '“').replace(/』/g, '”')
                       .replace(/《/g, '“').replace(/》/g, '”')
                       .replace(/«/g, '“').replace(/»/g, '”');
  formatted = formatted.replace(/【/g, '[').replace(/】/g, ']');

  // RAW OBFUSCATION CLEANUP: một số site raw chèn dấu ngoặc vuông ba lớp [[[ ]]] để
  // né bot quét (KHÔNG liên quan tới thẻ ID nội bộ [[[part_X]]] — thẻ đó đã được tách
  // ra khỏi nội dung trước khi hàm này chạy, nên an toàn để chuẩn hoá ở đây).
  formatted = formatted.replace(/\[{3}/g, '[').replace(/\]{3}/g, ']');

  // RAW OBFUSCATION CLEANUP: một số raw chèn dấu chấm giữa (·) xen vào giữa các chữ
  // trong từ nhạy cảm để né kiểm duyệt/bot quét (vd "g·iết", "t·ự s·át", "c·hết").
  // Xoá các dấu · nằm giữa 2 ký tự chữ cái để khôi phục lại từ gốc. Lặp lại vì có thể
  // có nhiều dấu chấm liên tiếp trong cùng 1 từ (vd "t·h·ương").
  while (/\p{L}·\p{L}/u.test(formatted)) {
    formatted = formatted.replace(/(\p{L})·(\p{L})/gu, '$1$2');
  }

  // DẤU CÂU KẾT THÚC LỜI THOẠI: 2 lỗi phổ biến khi AI dịch thoại trực tiếp.
  // (1) Dấu chấm bị đặt RA NGOÀI dấu ngoặc kép thay vì bên trong (chuẩn tiếng Việt đặt bên
  //     trong): "Xin chào”. -> "Xin chào.”
  // (2) Dòng CHỈ chứa 1 câu thoại trọn vẹn (không có gì khác ngoài ngoặc kép) nhưng thiếu hẳn
  //     dấu câu kết thúc trước dấu ngoặc đóng: "Xin chào” -> "Xin chào.”
  // Chỉ áp dụng cho dòng ĐÚNG 1 câu thoại trọn vẹn (không có văn bản tường thuật kèm theo) để
  // tránh can thiệp nhầm vào các câu thoại nhiều vế ngắt quãng bởi lời dẫn truyện.
  formatted = formatted.replace(/^([ \t]*)“([^“”\n]*)”\.([ \t]*)$/gm, "$1“$2.”$3");
  formatted = formatted.replace(/^([ \t]*)“([^“”\n]*[^\s“”])”([ \t]*)$/gm, (m, lead, inner, trail) => {
    const endPunct = ['.', '!', '?', '…', ',', '~', '～', '—', '－', '-'];
    if (endPunct.includes(inner[inner.length - 1])) return m;
    return `${lead}“${inner}.”${trail}`;
  });

  // BẢO VỆ IN ĐẬM/IN NGHIÊNG MARKDOWN HỢP LỆ (**đậm** / *nghiêng*) trước khi xoá ký tự
  // rác "*" bên dưới. **...** dùng cho hệ thống/thông báo, *...* dùng đánh dấu NỘI TÂM
  // (phân biệt với hội thoại trong ngoặc kép "...") — xem quy tắc 13 trong getSpecificRules.
  // Chỉ bảo vệ cặp dấu * có chứa CHỮ CÁI thật sự bên trong; các cụm sao rời rạc/trang trí
  // thuần túy (***, * * *, dấu * lẻ loi) vẫn bị xoá như cũ để không phá vỡ hành vi hiện có.
  const protectedMarkdownSpans: string[] = [];
  const protectMarkdownSpan = (s: string) => {
    protectedMarkdownSpans.push(s);
    return `\u2063MD${protectedMarkdownSpans.length - 1}\u2063`;
  };
  formatted = formatted.replace(/\*\*([^\n*]*\p{L}[^\n*]*)\*\*/gu, (_m, inner) => protectMarkdownSpan(`**${inner}**`));
  formatted = formatted.replace(/\*([^\n*]*\p{L}[^\n*]*)\*/gu, (_m, inner) => protectMarkdownSpan(`*${inner}*`));

  formatted = formatted
    .replace(/[*#~=]+/g, "")
    .replace(/(?:-\s*){2,}/g, "")
    .replace(/(?:_\s*){2,}/g, "")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/([.?!])[ \t]*(?=\p{Lu})/gu, "$1 ")
    .replace(/([:,])[ \t]*(?=\p{L})/gu, "$1 ")
    .replace(/([:,])[ \t]*(["'“‘«「『【《])(?=\p{L})/gu, "$1 $2")
    .replace(/[ \t]+([.,?!:;])/g, "$1")
    .replace(/(["'”’»」』】》])[ \t]+([.,?!:;])/g, "$1$2")
    .replace(/([.,?!:;])[ \t]+([”’»」』】》])/g, "$1$2")
    .replace(/([.,?!:;])[ \t]+(["'])(?=[ \t]*$|[ \t]+\p{L})/gu, "$1$2")
    .replace(/([.?!]["'”’»」』】》])[ \t]*(?=\p{L})/gu, "$1 ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n /g, "\n")
    .replace(/ \n/g, "\n")
    .trim();

  if (protectedMarkdownSpans.length) {
    formatted = formatted.replace(/\u2063MD(\d+)\u2063/g, (_m, idx) => protectedMarkdownSpans[Number(idx)] ?? "");
  }

  // Smart Paragraph Formatter: Merge broken lines if previous line doesn't end with sentence-ending punctuation
  formatted = formatted.replace(/([^.?!\"'”’»」』】》>\]\n])\n+([a-zàáảãạăằắẳẵặngâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ])/g, "$1 $2");

  // Replace typical convert slangs
  formatted = formatted.replace(
    /\b(ta gõ|ta kháo|ta thảo|ngọa tào|ngọa thảo)\b/gi,
    "mẹ kiếp",
  );
  formatted = formatted.replace(/\b(nê mã|ni mã)\b/gi, "chết tiệt");
  formatted = formatted.replace(/\b(ngạnh sinh sinh)\b/gi, "cứ thế");
  formatted = formatted.replace(/\bđều không chỉ\b/gi, "thậm chí còn hơn");
  formatted = formatted.replace(
    /\bkhông có một trong\b/gi,
    "không ai sánh bằng",
  );

  // Custom explicit slang fixes requested by user
  formatted = formatted.replace(/\btamo\b/gi, "bao");
  formatted = formatted.replace(/\btam o\b/gi, "bao");
  formatted = formatted.replace(/\bsúc sinh a(?:,|)\s+đây đều là\b/gi, "đây đều là súc sinh a");
  formatted = formatted.replace(/\bmấy con thịt rồng\b/gi, "thịt mấy con rồng");
  formatted = formatted.replace(/\brồng thịt\b/gi, "thịt rồng");
  formatted = formatted.replace(/\btôm binh cua tướng\b/gi, "binh tôm tướng cua");
  formatted = formatted.replace(/\brất bị thương\b/gi, "bị thương rất nặng");
  formatted = formatted.replace(/\bhoàn toàn\s+0\b/gi, "hoàn toàn không");
  formatted = formatted.replace(/\b0\s+(có|thể|cần|phải|chỉ|quan|cân|để|nghĩ|thấy|nói|làm|hiểu|biết|ngờ|ngừng|dám|muốn)\b/gi, "không $1");

  // Inverted translated terms
  formatted = formatted.replace(/\bcho ta (đâm|đỡ|hủy diệt|phá|cút|chết|giết|bạo|ngừng|quỳ|câm|quỳ xuống|cút ngay|biến|im miệng|đứt|chém|đánh|nuốt)\b/gi, "$1 cho ta");
  formatted = formatted.replace(/\btử đệ\b/gi, "đệ tử");
  formatted = formatted.replace(/\bnhi nữ\b/gi, "nữ nhi");
  
  formatted = formatted.replace(/\b(hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s+tộc\s+lão\s+tổ\b/gi, "lão tổ $1 tộc");
  formatted = formatted.replace(/\blời\s+(?:nói\s+)?(?:của\s+)?(.*?)\s+rơi\s+xuống\b/gi, "lời của $1 vừa dứt");
  formatted = formatted.replace(/\b(tiếng|giọng)\s+nói\s+(?:của\s+)?(.*?)\s+rơi\s+xuống\b/gi, "$1 nói của $2 vừa dứt");
  formatted = formatted.replace(/\bbất quá\b/gi, "nhưng");
  formatted = formatted.replace(/\bnương thân\b/gi, "mẫu thân");
  formatted = formatted.replace(/\bsơn xuyên\b/gi, "núi sông");
  formatted = formatted.replace(/\bsơn mạch\b/gi, "đồi núi");
  formatted = formatted.replace(/\bâm thanh rơi xuống\b/gi, "tiếng vừa dứt");
  formatted = formatted.replace(/\bcẩu cấp khiêu tường\b/gi, "chó cùng dứt giậu");
  
  // Remove trailing " a" in questions/exclamations
  formatted = formatted.replace(/\b(ai|nào|thế|sao|đâu|gì|kia|đấy|nhỉ|nhé|thôi|vậy|hả|chứ)\s+a\s*([?!.])/gi, "$1$2");
  formatted = formatted.replace(/\b(không|quá|lắm|thật)\s+a\s*([?!.])/gi, "$1$2");

  // formatted = formatted.replace(/\bhai 10\b/gi, "20");
  // formatted = formatted.replace(/\bba 10\b/gi, "30");
  // formatted = formatted.replace(/\bbốn 10\b/gi, "40");
  // formatted = formatted.replace(/\bnăm 10\b/gi, "50");
  // formatted = formatted.replace(/\bsáu 10\b/gi, "60");
  // formatted = formatted.replace(/\bbảy 10\b/gi, "70");
  // formatted = formatted.replace(/\btám 10\b/gi, "80");
  // formatted = formatted.replace(/\bchín 10\b/gi, "90");
  formatted = formatted.replace(/nhất\s*đường/gi, "một đường");
  formatted = formatted.replace(/mỗi cấp nhất giá/gi, "mỗi cấp một giá");
  formatted = formatted.replace(/mỗi cấp nhất lần/gi, "mỗi cấp một lần");
  formatted = formatted.replace(/cung cấp báchcân/gi, "cung cấp 100 cân");
  formatted = formatted.replace(/báchcân/gi, "100 cân");
  formatted = formatted.replace(/nhất giai nhân/gi, "một giai nhân");
  formatted = formatted.replace(/\bhạng 1000 kiêu\b/gi, "hạng thiên kiêu");
  formatted = formatted.replace(/\bnhất kiếp nạn\b/gi, "một kiếp nạn");
  formatted = formatted.replace(/\bviệc cấp 101\b/gi, "việc cấp bách nhất");
  formatted = formatted.replace(/\bthượng hàng trăm\b/gi, "trên hàng trăm");
  formatted = formatted.replace(
    /\bsinh\s+(?:0|linh)\s+triệu\s+hồi\b/gi,
    "sinh vật triệu hồi",
  );
  formatted = formatted.replace(
    /\b(tầng|bậc|hạng|trọng|cấp)(?:\s+thứ)?\s+thập\s*0\b/gi,
    "$1 100",
  );
  formatted = formatted.replace(
    /\b(tầng|bậc|hạng|trọng)(?:\s+thứ)?\s+bách\b/gi,
    "$1 100",
  );

  // Restore "năm" (year) that was wrongly converted into "5" or "10005" by translation tools or previous passes
  // Fix "Năm 10005 trước" -> "5 vạn năm trước"
  formatted = formatted.replace(/\bNăm\s+10005\s+trước\b/gi, "5 vạn năm trước");
  // Fix "10 vạn 5 trước" -> "10 vạn năm trước", "3 vạn 5 rồi" -> "3 vạn năm rồi", "10 vạn 5" -> "10 vạn năm"
  formatted = formatted.replace(
    /\b(\d+)\s*(vạn|triệu|tỷ|tỉ|ức|ngàn|nghìn|trăm|triệu|tỉ)\s+5(?=\s*(?:trước|sau|nữa|rồi|này|kia|tới|qua|kia|đó|\.|$|[!?.,]))/gi,
    "$1 $2 năm"
  );
  // Fix "1005" specifically translated from 'ngàn năm' incorrectly but only with specific modifiers
  formatted = formatted.replace(/\bhơn\s+1005(?!\d)\b/gi, "hơn ngàn năm");
  formatted = formatted.replace(/\bgần\s+1005(?!\d)\b/gi, "gần ngàn năm");
  formatted = formatted.replace(/\bmột\s+1005(?!\d)\b/gi, "một ngàn năm");
  formatted = formatted.replace(/\bvài\s+1005(?!\d)\b/gi, "vài ngàn năm");
  // REMOVED catch-all rule that destroyed "Chương 1005"

  // Common prose corrections where "1" should be "một"
  formatted = formatted.replace(/\b1\s+(chút|ít|lát|lúc|phen|mạch|cái|phần|tiếng|hồi|đời|kiếp|vị|người|tên|con|đạo|vòng|nhóm|nửa)\b/gi, "một $1");
  formatted = formatted.replace(/\bhơn\s+1\s+(chút|ít|lát|lúc|phần)\b/gi, "hơn một $1");


  // Fix AI hallucinating "1 1 trăm", "một 1 trăm", "1 một ngàn" and "1 1 1 1 ngàn"
  formatted = formatted.replace(
    /\b(?:1\s+){2,}(trăm|ngàn|nghìn|vạn|dặm|mét|tầng|bậc|cấp)\b/gi,
    "1 $1",
  );
  formatted = formatted.replace(
    /\b111+\s+(trăm|ngàn|nghìn|vạn|dặm|mét|tầng|bậc|cấp)\b/gi,
    "1 $1",
  ); // Match 111, 1111, 11111 etc, but skip 11
  formatted = formatted.replace(
    /\bmột\s+1\s+(trăm|ngàn|nghìn|vạn|dặm|mét|tầng|bậc|cấp)\b/gi,
    "1 $1",
  );
  formatted = formatted.replace(
    /\b1\s+một\s+(trăm|ngàn|nghìn|vạn|dặm|mét|tầng|bậc|cấp)\b/gi,
    "1 $1",
  );

  /* Fix comma separated mismatches like "hai, 3 ngày" -> "2, 3 ngày"
  formatted = formatted.replace(
    /\b(một|mốt|hai|ba|bốn|tư|năm|lăm|nhăm|sáu|bảy|bẩy|tám|chín|mười|mươi|chục)\s*,\s*(\d+)\b/gi,
    (match, p1, p2) => {
      const numMap: { [key: string]: string } = {
        một: "1",
        mốt: "1",
        hai: "2",
        ba: "3",
        bốn: "4",
        tư: "4",
        năm: "5",
        lăm: "5",
        nhăm: "5",
        sáu: "6",
        bảy: "7",
        bẩy: "7",
        tám: "8",
        chín: "9",
        mười: "10",
        mươi: "10",
        chục: "10",
      };
      const val = numMap[p1.toLowerCase()];
      if (val) {
        return `${val}, ${p2}`;
      }
      return match;
    },
  );

  formatted = formatted.replace(
    /\b(\d+)\s*,\s*(một|mốt|hai|ba|bốn|tư|năm|lăm|nhăm|sáu|bảy|bẩy|tám|chín|mười|mươi|chục)\b/gi,
    (match, p1, p2) => {
      const numMap: { [key: string]: string } = {
        một: "1",
        mốt: "1",
        hai: "2",
        ba: "3",
        bốn: "4",
        tư: "4",
        năm: "5",
        lăm: "5",
        nhăm: "5",
        sáu: "6",
        bảy: "7",
        bẩy: "7",
        tám: "8",
        chín: "9",
        mười: "10",
        mươi: "10",
        chục: "10",
      };
      const val = numMap[p2.toLowerCase()];
      if (val) {
        return `${p1}, ${val}`;
      }
      return match;
    },
  );
  */

  const lines = formatted.split("\n");
  const processedLines = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.length > 0) {
      line = line.charAt(0).toUpperCase() + line.slice(1);

      const upperCount = (line.match(/\p{Lu}/gu) || []).length;
      const letterCount = (line.match(/\p{L}/gu) || []).length;

      if (letterCount > 10 && upperCount / letterCount > 0.8) {
        line = line.charAt(0).toUpperCase() + line.slice(1).toLowerCase();
      }

      processedLines.push(line);
    }
  }

  // Nối 1 dòng trống ("\n") giữa các đoạn thay vì 2 dòng trống ("\n\n"). Khoảng cách thị giác
  // giữa các đoạn giờ do UI/DOCX/EPUB tự đảm nhiệm qua line-height/paragraph-spacing (xem
  // EditorModal.tsx `leading-[1.5]`, exporters.ts DOCX `spacing.after`, epubWriter CSS
  // `design.lineHeight`/`design.paragraphSpacing`) — không cần chèn cứng dòng trống vào data nữa.
  // LƯU Ý: file .txt xuất ra (plain text, không có CSS) vẫn cần dòng trống thật để đọc được,
  // việc chèn lại dòng trống cho riêng .txt được xử lý ở utils/file/exporters.ts (toTxtOutput).
  return processedLines.join("\n");
};
