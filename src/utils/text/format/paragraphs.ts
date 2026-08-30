// Xử lý ghép/tách đoạn văn: gộp câu dịch lại thành đoạn theo số đoạn gốc,
// hoặc tách đoạn quá dài (có hội thoại) thành nhiều đoạn nhỏ hơn.

// CHỈ dùng khi COPY bản dịch ra ngoài (không đụng vào nội dung đang lưu/hiển
// thị trong ô sửa của Editor). Gộp mọi chuỗi xuống dòng liên tiếp (1 dòng hay
// nhiều dòng) thành đúng 1 dòng trống (\n\n), để văn bản copy ra ngoài có giãn
// cách giữa các đoạn giống bên Bản Gốc (Raw), thay vì các đoạn dính sát nhau
// nếu model dịch chỉ xuống dòng đơn giữa các đoạn.
export const addBlankLineBetweenParagraphs = (text: string): string => {
  if (!text) return text;
  return text.replace(/\n+/g, "\n\n").trim();
};
export const attemptFormatMergedParagraphs = (
  raw: string,
  translated: string,
): string | null => {
  if (!raw || !translated) return null;
  const rawParas = raw
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  // Split translated text into sentences
  const translatedSentences = translated
    .split(/(?<=[.?!”"’»」』】》])\s+(?=\p{Lu}|["'“‘«「『【《])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // If the number of sentences in translated roughly matches the number of paragraphs in raw
  // This is a simple heuristic. If it matches, we assume each sentence is a paragraph.
  if (
    rawParas.length > 3 &&
    Math.abs(rawParas.length - translatedSentences.length) <= 2
  ) {
    return translatedSentences.join("\n\n");
  }

  return null; // Failed to format locally, need AI re-translation
};

export const splitLongParagraphs = (text: string): string => {
  if (!text) return text;
  const lines = text.split("\n");
  const result = [];
  for (let line of lines) {
    line = line.trim();
    if (line.length > 200) {
      // Split before dialogue: `. “` -> `.\n\n“`
      let splitLine = line.replace(/([.?!])\s+(?=[“"‘«「『【《])/g, "$1\n\n");
      // Split after dialogue: `” A` -> `”\n\n A`
      splitLine = splitLine.replace(
        /([”"’»」』】》])\s+(?=\p{Lu})/gu,
        "$1\n\n",
      );

      const sublines = splitLine.split("\n\n");
      const finalSublines = [];
      for (const sub of sublines) {
        if (sub.length > 300) {
          // Split by sentence if still very long
          const sentences = sub.split(/([.?!])\s+(?=\p{Lu})/u);
          let currentPara = "";
          for (let i = 0; i < sentences.length; i += 2) {
            const sentence = sentences[i] + (sentences[i + 1] || "");
            if (
              currentPara.length + sentence.length > 200 &&
              currentPara.length > 0
            ) {
              finalSublines.push(currentPara.trim());
              currentPara = sentence + " ";
            } else {
              currentPara += sentence + " ";
            }
          }
          if (currentPara.trim()) {
            finalSublines.push(currentPara.trim());
          }
        } else {
          finalSublines.push(sub.trim());
        }
      }
      result.push(finalSublines.join("\n\n"));
    } else {
      result.push(line);
    }
  }
  return result.join("\n\n");
};
