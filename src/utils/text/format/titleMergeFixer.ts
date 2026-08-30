// Sửa lỗi tiêu đề chương bị AI dịch dính liền với câu văn đầu tiên (không xuống dòng).
import { UPPER_VI, LOWER_VI } from '../regex';

export const fixMergedTitle = (text: string): string => {
  if (!text) return text;

  const lines = text.split("\n");
  let textChanged = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (
      line.length > 10 &&
      /^(?:Chương|Tiết|Hồi|Phần|Quyển|Tập)\s+\d+/i.test(line)
    ) {
      let splitIndex = -1;
      const possibleIndices: number[] = [];
      const searchArea = line.substring(0, 500); // Only search for split points in the first 500 chars

      const patterns = [
        new RegExp(`([.?!”’»」』】》"])\\s+([${UPPER_VI}“‘«「『【《"])`, "g"),
        new RegExp(`(["'”’»」』】》][.?!])\\s+([${UPPER_VI}])`, "g"),
        new RegExp(`([.?!”’»」』】》])([${UPPER_VI}“‘«「『【《])`, "g"),
        new RegExp(`([.?!]["'”’»」』】》]?)([${UPPER_VI}"'“‘«「『【《])`, "g"),
        new RegExp(`([${LOWER_VI}])([${UPPER_VI}])`, "g"),
        new RegExp(`([${LOWER_VI}])([${LOWER_VI}]*(.)\\3{3,})`, "gi"),
        new RegExp(`([\\]\\)”’»」』】》])([${UPPER_VI}${LOWER_VI}])`, "g"),
        new RegExp(`([${UPPER_VI}${LOWER_VI}\\d])([\\[\\(“‘«「『【《])`, "g"),
        new RegExp(`([.?!])\\s+(["'“‘«「『【《])`, "g"),
        new RegExp(
          `([${UPPER_VI}${LOWER_VI}\\d])([”’\\[\\(“‘«「『【《])([${UPPER_VI}])`,
          "g",
        ),
        new RegExp(`([${UPPER_VI}${LOWER_VI}\\d])\\s+(["“‘«「『【《])`, "g"),
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(searchArea)) !== null) {
          const idx = match.index + match[1].length;
          possibleIndices.push(idx);
        }
      }

      // Handle case where title has no punctuation and is merged with content
      if (searchArea.length > 200) {
        const matchSpace = searchArea.match(
          new RegExp(
            `^(?:Chương|Tiết|Hồi|Phần|Quyển|Tập)\\s+\\d+[^:]*:\\s*.{5,100}?([${LOWER_VI}])\\s+([${UPPER_VI}])`,
          ),
        );
        if (matchSpace && matchSpace.index !== undefined) {
          const splitPos = matchSpace[0].length - matchSpace[2].length - 1;
          possibleIndices.push(splitPos + 1);
        }
      }

      const validIndices = possibleIndices.filter((idx) => {
        const beforeSplit = line.substring(0, idx);
        const quoteCount = (beforeSplit.match(/["“”]/g) || []).length;
        if (quoteCount % 2 !== 0) {
          return false;
        }

        const afterSplit = line.substring(idx, 500).trim();
        const quoteMatch = afterSplit.match(
          /^([“‘«「『【《"'])(.*?)([”’»」』】》"'])/,
        );
        if (quoteMatch) {
          const quoteContent = quoteMatch[2];
          const afterQuote = afterSplit.substring(quoteMatch[0].length).trim();
          if (afterQuote.length > 0 && quoteContent.length < 50) {
            return false;
          }
        }
        return true;
      });

      if (validIndices.length > 0) {
        splitIndex = Math.min(...validIndices);

        const titlePart = line.substring(0, splitIndex).trim();
        let contentPart = line.substring(splitIndex).trim();

        // Check if contentPart looks like a title (short, mostly 1 sentence)
        const isContentPartTitle =
          contentPart.length < 100 &&
          (contentPart.match(/[.?!]/g) || []).length <= 1;

        if (
          titlePart.length < 150 &&
          contentPart.length > 2 &&
          !isContentPartTitle
        ) {
          contentPart =
            contentPart.charAt(0).toUpperCase() + contentPart.slice(1);
          lines[i] = titlePart + "\n\n" + contentPart;
          textChanged = true;
        }
      }
    }
  }

  if (textChanged) {
    text = lines.join("\n");
  }

  return text;
};
