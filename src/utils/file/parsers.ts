// Đọc/parse các định dạng file đầu vào: zip (giải nén), docx, pdf, epub.
import { FileItem, FileStatus, StoryInfo } from '../../types';
import { padNumber, sanitizeFilename, resolvePath } from './shared';
import { readFileAsText, parseFilenameMetadata } from './core';
import { splitJapaneseVerticalPdfByMarkers } from './pdfVerticalChapterSplitter';
import { detectChapterFormat } from './splitters';
import { cleanGarbageText } from '../text/garbageCleaner';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// NÂNG CẤP (đề xuất mục 4.2): jszip/pdfjs-dist nặng (~734KB chunk vendor-docs) nhưng chỉ dùng
// khi người dùng NHẬP file zip/epub/docx/pdf — trước đây bị import tĩnh nên tải kèm lần đầu
// mở app dù không cần. Chuyển sang dynamic import tại điểm gọi: chunk chỉ được tải lần đầu
// có nhập tài liệu (sau đó dùng lại từ cache module). Mỗi loader giữ đúng 1 promise dùng chung.
type JsZipModule = typeof import('jszip');
let jszipPromise: Promise<{ default: JsZipModule }> | null = null;
// jszip dùng "export =" nên kết quả dynamic import là { default: JSZipClass }
const loadJsZip = (): Promise<{ default: JsZipModule }> => {
    if (!jszipPromise) jszipPromise = import('jszip') as unknown as Promise<{ default: JsZipModule }>;
    return jszipPromise;
};

type PdfJsModule = typeof import('pdfjs-dist');
const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL}assets/pdfjs`;
let pdfjsPromise: Promise<PdfJsModule> | null = null;
const loadPdfjs = (): Promise<PdfJsModule> => {
    if (!pdfjsPromise) {
        pdfjsPromise = import('pdfjs-dist').then((pdfjsLib) => {
            // Worker được Vite phát hành cùng app: không phụ thuộc CDN và không rơi về fake worker.
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
            return pdfjsLib;
        });
    }
    return pdfjsPromise;
};

export const unzipFiles = async (file: File, onProgress?: (current: number, total: number, percent: number) => void): Promise<FileItem[]> => {
  const { default: JSZip } = await loadJsZip();
  const zip = new JSZip();
  if (onProgress) onProgress(0, 0, 5);
  const loadedZip = await zip.loadAsync(file);
  const files: FileItem[] = [];
  const filePaths = Object.keys(loadedZip.files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const total = filePaths.length;
  const BATCH_SIZE = 50; 

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batchPaths = filePaths.slice(i, i + BATCH_SIZE);
    const batchPromises = batchPaths.map(async (relativePath) => {
        const zipEntry = loadedZip.files[relativePath];
        if (!zipEntry.dir) {
            const lowerName = zipEntry.name.toLowerCase();
            if (lowerName.endsWith('.txt') || lowerName.endsWith('.xml') || lowerName.endsWith('.html') || lowerName.endsWith('.md') || lowerName.endsWith('.xhtml') || lowerName.endsWith('.srt') || lowerName.endsWith('.vtt')) {
                let content = await zipEntry.async('string');
                if (lowerName.endsWith('.html') || lowerName.endsWith('.xhtml') || lowerName.endsWith('.xml')) {
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(content, "text/html");
                        const scripts = doc.getElementsByTagName('script');
                        const styles = doc.getElementsByTagName('style');
                        for (let j = scripts.length - 1; j >= 0; j--) scripts[j].parentNode?.removeChild(scripts[j]);
                        for (let j = styles.length - 1; j >= 0; j--) styles[j].parentNode?.removeChild(styles[j]);
                        const text = doc.body ? doc.body.innerText : (doc.documentElement.textContent || content);
                        content = text.trim();
                    } catch (e) { console.warn("Failed to parse HTML/XHTML in zip", e); }
                }
                const pureName = zipEntry.name.split('/').pop() || zipEntry.name;
                return { id: crypto.randomUUID(), name: pureName, content: content, translatedContent: null, status: FileStatus.IDLE, retryCount: 0, originalCharCount: content.length, remainingRawCharCount: 0 } as FileItem;
            }
        }
        return null;
    });
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(res => { if (res) files.push(res); });
    if (onProgress) {
        const currentCount = Math.min(i + BATCH_SIZE, total);
        const percent = 10 + Math.round((currentCount / total) * 90);
        onProgress(currentCount, total, percent);
    }
    await new Promise(r => setTimeout(r, 0));
  }
  if (onProgress) onProgress(total, total, 100);
  return files;
};

export const parseDocx = async (file: File): Promise<{ content: string, title?: string, author?: string }> => {
    try {
        const { default: JSZip } = await loadJsZip();
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        const xmlContent = await loadedZip.file("word/document.xml")?.async("string");
        if (!xmlContent) throw new Error("File DOCX không hợp lệ");
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
        const paragraphs = xmlDoc.getElementsByTagName("w:p");
        let fullText = "";
        for (let i = 0; i < paragraphs.length; i++) {
            const p = paragraphs[i];
            let pText = "";
            const runs = p.getElementsByTagName("w:r");
            for (let j = 0; j < runs.length; j++) {
                const r = runs[j];
                for (let k = 0; k < r.childNodes.length; k++) {
                    const node = r.childNodes[k];
                    if (node.nodeName === "w:t") {
                        pText += node.textContent;
                    } else if (node.nodeName === "w:br" || node.nodeName === "w:cr") {
                        pText += "\n";
                    } else if (node.nodeName === "w:tab") {
                        pText += "\t";
                    }
                }
            }
            if (pText) fullText += pText + "\n";
        }
        let title = undefined;
        let author = undefined;
        const coreXml = await loadedZip.file("docProps/core.xml")?.async("string");
        if (coreXml) {
            const coreDoc = parser.parseFromString(coreXml, "text/xml");
            const titleNode = coreDoc.getElementsByTagName("dc:title")[0] || coreDoc.getElementsByTagName("title")[0];
            const creatorNode = coreDoc.getElementsByTagName("dc:creator")[0] || coreDoc.getElementsByTagName("creator")[0];
            if (titleNode && titleNode.textContent) title = titleNode.textContent.trim();
            if (creatorNode && creatorNode.textContent) author = creatorNode.textContent.trim();
        }
        return { content: fullText.trim(), title, author };
    } catch (e: any) { throw new Error(`Lỗi đọc file DOCX: ${e.message}`, { cause: e }); }
};

export const parsePdf = async (file: File, onProgress?: (percent: number, msg: string) => void): Promise<{ content: string, files: FileItem[], title?: string, author?: string }> => {
    try {
        const pdfjsLib = await loadPdfjs();
        const arrayBuffer = await file.arrayBuffer();
        // Một số PDF (đặc biệt PDF tiếng Nhật/Trung dùng font CID nhúng, ví dụ các bản convert
        // từ Syosetu) cần dữ liệu CMap + font chuẩn để pdfjs giải mã đúng ký tự. Thiếu 2 tham số
        // này, pdfjs âm thầm đọc được 0 ký tự ở MỌI trang (không báo lỗi), khiến toàn bộ nội dung
        // hiện thành "[TRANG N: KHÔNG TÌM THẤY VĂN BẢN]". Trỏ tới cùng CDN đã dùng cho pdf.worker.
        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuffer,
            cMapUrl: `${PDFJS_ASSET_BASE}/cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${PDFJS_ASSET_BASE}/standard_fonts/`,
        });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages;
        let metaTitle = undefined;
        let metaAuthor = undefined;
        try {
            const metadata = await pdf.getMetadata();
            if (metadata.info) {
                if ((metadata.info as any).Title) metaTitle = (metadata.info as any).Title;
                if ((metadata.info as any).Author) metaAuthor = (metadata.info as any).Author;
            }
        } catch { /* ignore */ }
        const pageCache: string[] = new Array(totalPages + 1).fill("");
        const pageItemsCache: (string[] | undefined)[] = new Array(totalPages + 1);
        const BATCH_SIZE = 10;
        for (let i = 1; i <= totalPages; i += BATCH_SIZE) {
            const end = Math.min(i + BATCH_SIZE - 1, totalPages);
            const promises = [];
            if (onProgress) onProgress(Math.round(((i - 1) / totalPages) * 70), `Đang đọc trang ${i}-${end}/${totalPages}...`);
            for (let p = i; p <= end; p++) {
                promises.push(pdf.getPage(p).then(async (page) => {
                    const textContent = await page.getTextContent();
                    const itemStrs = textContent.items.map((item: any) => item.str as string);
                    // Nối bằng \n thay vì khoảng trắng: mỗi item pdfjs trả về ~ 1 dòng chữ dọc
                    // thực tế trong PDF gốc (do được vẽ bằng 1 lệnh Tj riêng), nối bằng dấu cách
                    // làm mất hết ranh giới dòng/thoại, gộp cả trang thành 1 dòng dài duy nhất.
                    const pageText = itemStrs.filter(s => s.trim() !== '').join('\n');
                    page.cleanup();
                    if (pageText.length < 50 && textContent.items.length < 5) return { text: `\n\n[TRANG ${p}: KHÔNG TÌM THẤY VĂN BẢN]\n`, items: itemStrs };
                    else return { text: pageText + "\n\n", items: itemStrs };
                }));
            }
            const results = await Promise.all(promises);
            results.forEach((res, idx) => { pageCache[i + idx] = res.text; pageItemsCache[i + idx] = res.items; });
            await new Promise(r => setTimeout(r, 10));
        }
        if (onProgress) onProgress(80, "Đang kiểm tra mục lục...");
        const outline = await pdf.getOutline();
        const splitFiles: FileItem[] = [];
        let fullText = "";
        if (outline && outline.length > 0) {
            if (onProgress) onProgress(90, "Phát hiện mục lục! Đang chia chương...");
            const getPageIndex = async (dest: any): Promise<number> => {
                if (typeof dest === 'string') {
                    const destArray = await pdf.getDestination(dest);
                    return destArray ? await pdf.getPageIndex(destArray[0]) : -1;
                }
                else if (Array.isArray(dest)) return await pdf.getPageIndex(dest[0]);
                return -1;
            };
            const chapters: { title: string, startPage: number }[] = [];
            for (const item of outline) {
                if (item.dest) {
                    try {
                        const pageIdx = await getPageIndex(item.dest);
                        if (pageIdx >= 0) chapters.push({ title: item.title, startPage: pageIdx + 1 });
                    } catch { /* ignore */ }
                }
            }
            chapters.sort((a, b) => a.startPage - b.startPage);
            const uniqueChapters = chapters.filter((c, index, self) => index === 0 || c.startPage > self[index - 1].startPage);
            for (let i = 0; i < uniqueChapters.length; i++) {
                const current = uniqueChapters[i];
                const next = uniqueChapters[i + 1];
                const startPage = current.startPage;
                const endPage = next ? next.startPage - 1 : totalPages;
                let chapterContent = "";
                for (let p = startPage; p <= endPage; p++) chapterContent += pageCache[p] || "";
                if (chapterContent.trim().length > 0) {
                    const chapterIndex = splitFiles.length + 1;
                    let safeTitle = sanitizeFilename(current.title);
                    if (safeTitle.length > 80) safeTitle = safeTitle.substring(0, 80);
                    const cleanedContent = cleanGarbageText(chapterContent.trim());
                    splitFiles.push({ id: crypto.randomUUID(), name: `${padNumber(chapterIndex)} ${safeTitle}`, content: cleanedContent, translatedContent: null, status: FileStatus.IDLE, retryCount: 0, originalCharCount: cleanedContent.length, remainingRawCharCount: 0 });
                }
            }
        }
        // PDF không có mục lục (outline) -> thử nhận diện chương theo cấu trúc tiêu đề chương
        // dọc tiếng Nhật (kiểu convert Syosetu: "＃1" / "1：tiêu đề"). Chỉ chấp nhận kết quả nếu
        // tìm được từ 2 chương trở lên, tránh việc 1-2 lần khớp tình cờ phá vỡ luồng full-text
        // bình thường cho các PDF tiếng Nhật khác không theo định dạng này.
        if (splitFiles.length === 0) {
            if (onProgress) onProgress(90, "Không có mục lục, đang dò tiêu đề chương theo cấu trúc PDF dọc...");
            try {
                const verticalChapters = splitJapaneseVerticalPdfByMarkers(pageItemsCache);
                if (verticalChapters.length >= 2) {
                    for (const vc of verticalChapters) {
                        const chapterIndex = splitFiles.length + 1;
                        let safeTitle = sanitizeFilename(vc.title || `Chương ${chapterIndex}`);
                        if (safeTitle.length > 80) safeTitle = safeTitle.substring(0, 80);
                        splitFiles.push({ id: crypto.randomUUID(), name: `${padNumber(chapterIndex)} ${safeTitle}`, content: vc.content, translatedContent: null, status: FileStatus.IDLE, retryCount: 0, originalCharCount: vc.content.length, remainingRawCharCount: 0, chapterFormat: detectChapterFormat(vc.title) });
                    }
                }
            } catch (e) { console.warn("Lỗi khi dò chương PDF dọc tiếng Nhật, bỏ qua và dùng toàn văn.", e); }
        }
        if (splitFiles.length === 0) fullText = pageCache.join("");
        if (onProgress) onProgress(100, "Hoàn tất.");
        return { content: fullText.trim(), files: splitFiles, title: metaTitle, author: metaAuthor };
    } catch (e: any) { throw new Error(`Lỗi đọc PDF: ${e.message}`, { cause: e }); }
};

export const readDocumentContent = async (file: File): Promise<string> => {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.docx')) {
        const result = await parseDocx(file);
        return result.content;
    } else if (fileName.endsWith('.pdf')) {
        const result = await parsePdf(file);
        if (result.files.length > 0) return result.files.map(f => f.content).join("\n\n");
        return result.content;
    } else {
        return await readFileAsText(file);
    }
};

export const parseEpub = async (file: File, onProgress?: (current: number, total: number, percent: number) => void): Promise<{ files: FileItem[], info: Partial<StoryInfo>, coverBlob: Blob | null, needsSplit: boolean }> => {
  const { default: JSZip } = await loadJsZip();
  const zip = new JSZip();
  if (onProgress) onProgress(0, 0, 5);
  const loadedZip = await zip.loadAsync(file);
  if (onProgress) onProgress(0, 0, 15);
  const containerXml = await loadedZip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("File EPUB lỗi: Không tìm thấy META-INF/container.xml");
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, "text/xml");
  const rootFileNode = containerDoc.getElementsByTagName("rootfile")[0];
  const opfPath = rootFileNode?.getAttribute("full-path");
  if (!opfPath) throw new Error("File EPUB lỗi: Không tìm thấy file gốc (rootfile)");
  const opfContent = await loadedZip.file(opfPath)?.async("string");
  if (!opfContent) throw new Error(`File EPUB lỗi: Không tìm thấy file OPF`);
  const opfDoc = parser.parseFromString(opfContent, "text/xml");
  const { title: fnTitle, author: fnAuthor } = parseFilenameMetadata(file.name);
  const getMetaText = (tag: string) => {
      const el = opfDoc.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", tag)[0] || opfDoc.getElementsByTagName("dc:" + tag)[0] || opfDoc.getElementsByTagName(tag)[0];
      return el ? el.textContent?.trim() || "" : "";
  };
  let metadataTitle = getMetaText("title");
  let metadataAuthor = getMetaText("creator");
  const isGeneric = (s: string) => !s || s.trim() === "" || /^(unknown|untitled|ebook|sách|truyện|no title|generated by|calibre|author)$/i.test(s.trim());
  if (isGeneric(metadataTitle)) metadataTitle = fnTitle;
  if (isGeneric(metadataAuthor)) metadataAuthor = fnAuthor;
  const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
  const getFullPath = (href: string) => opfDir ? `${opfDir}/${href}` : href;
  const manifestItems = opfDoc.getElementsByTagName("item");
  const manifest: Record<string, string> = {};
  let coverHref: string | null = null;
  let metaCoverId: string | null = null;
  const metaElements = opfDoc.getElementsByTagName("meta");
  for(let i=0; i<metaElements.length; i++) { if(metaElements[i].getAttribute("name") === "cover") { metaCoverId = metaElements[i].getAttribute("content"); break; } }
  const imageCandidates: {href: string, id: string}[] = [];
  for (let i = 0; i < manifestItems.length; i++) {
    const item = manifestItems[i];
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
        manifest[id] = href;
        if (/\.(jpg|jpeg|png|webp|gif)$/i.test(href)) imageCandidates.push({ href, id });
        if (item.getAttribute("properties")?.includes("cover-image")) coverHref = href;
    }
  }
  if (!coverHref && metaCoverId && manifest[metaCoverId]) coverHref = manifest[metaCoverId];
  if (!coverHref && imageCandidates.length > 0) coverHref = imageCandidates[0].href;
  let coverBlob: Blob | null = null;
  if (coverHref) {
      const coverFile = loadedZip.file(getFullPath(coverHref));
      if (coverFile) coverBlob = await coverFile.async("blob");
  }
  const spineItems = opfDoc.getElementsByTagName("itemref");
  
  // Parse TOC
  const tocItems: { title: string, href: string, barePath: string, fragment: string | null }[] = [];
  let tocHref: string | null = null;
  const tocId = opfDoc.getElementsByTagName("spine")[0]?.getAttribute("toc");
  if (tocId && manifest[tocId]) {
      tocHref = manifest[tocId];
  } else {
      for (let i = 0; i < manifestItems.length; i++) {
          if (manifestItems[i].getAttribute("properties")?.includes("nav")) {
              tocHref = manifestItems[i].getAttribute("href");
              break;
          }
      }
  }

  if (tocHref) {
      const tocContent = await loadedZip.file(getFullPath(tocHref))?.async("string");
      if (tocContent) {
          const tocFullPath = getFullPath(tocHref);
          if (tocHref.endsWith('.ncx')) {
              const ncxDoc = parser.parseFromString(tocContent, "text/xml");
              const navPoints = ncxDoc.getElementsByTagName("navPoint");
              const pointsArray = Array.from(navPoints);
              pointsArray.sort((a, b) => {
                  const orderA = parseInt(a.getAttribute("playOrder") || "0");
                  const orderB = parseInt(b.getAttribute("playOrder") || "0");
                  return orderA - orderB;
              });
              for (const np of pointsArray) {
                  const text = np.getElementsByTagName("text")[0]?.textContent?.trim() || `Chương ${tocItems.length + 1}`;
                  const src = np.getElementsByTagName("content")[0]?.getAttribute("src");
                  if (src) {
                      const fullSrc = resolvePath(tocFullPath, src);
                      const [barePath, fragment] = fullSrc.split('#');
                      tocItems.push({ title: text, href: fullSrc, barePath, fragment: fragment || null });
                  }
              }
          } else {
              const navDoc = parser.parseFromString(tocContent, "text/html");
              const aTags = navDoc.querySelectorAll("nav[epub\\:type='toc'] a, nav[type='toc'] a, .toc a, #toc a");
              for (let i = 0; i < aTags.length; i++) {
                  const a = aTags[i];
                  const text = a.textContent?.trim() || `Chương ${tocItems.length + 1}`;
                  const href = a.getAttribute("href");
                  if (href) {
                      const fullSrc = resolvePath(tocFullPath, href);
                      const [barePath, fragment] = fullSrc.split('#');
                      tocItems.push({ title: text, href: fullSrc, barePath, fragment: fragment || null });
                  }
              }
          }
      }
  }

  const tocByFile = new Map<string, typeof tocItems>();
  for (const item of tocItems) {
      if (!tocByFile.has(item.barePath)) tocByFile.set(item.barePath, []);
      tocByFile.get(item.barePath)!.push(item);
  }

  const rawFiles: FileItem[] = [];
  const orderedExtracts: { rawText: string, extractedTitle?: string, hasToc: boolean }[] = [];
  const processedPaths = new Set<string>();
  const totalSpine = spineItems.length;
  const BATCH_SIZE = 50; 
  for (let i = 0; i < totalSpine; i += BATCH_SIZE) {
    const batchSpine = Array.from(spineItems).slice(i, i + BATCH_SIZE);
    const itemsToProcess: { barePath: string, index: number }[] = [];
    for(const itemRef of batchSpine) {
        const idref = itemRef.getAttribute("idref");
        if (!idref || !manifest[idref]) continue;
        const fullPath = getFullPath(manifest[idref]);
        const barePath = fullPath.split('#')[0];
        if (!processedPaths.has(barePath)) {
            processedPaths.add(barePath);
            itemsToProcess.push({ barePath, index: 0 }); 
        }
    }
    const contentPromises = itemsToProcess.map(async (item) => {
        const fileContent = await loadedZip.file(item.barePath)?.async("string");
        if (!fileContent) return null;
        
        const fileToc = tocByFile.get(item.barePath);
        
        // Pre-process HTML to ensure block elements are separated by newlines
        const processedContent = fileContent
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n</$1>')
            .replace(/<(p|div|h[1-6]|li|tr)[^>]*>/gi, '\n<$1>');
            
        const htmlDoc = parser.parseFromString(processedContent, "text/html");
        const scripts = htmlDoc.getElementsByTagName('script');
        const styles = htmlDoc.getElementsByTagName('style');
        for (let j = scripts.length - 1; j >= 0; j--) scripts[j].parentNode?.removeChild(scripts[j]);
        for (let j = styles.length - 1; j >= 0; j--) styles[j].parentNode?.removeChild(styles[j]);
        
        // hasToc = đoạn văn bản này BẮT ĐẦU một mục trong Mục lục thật (navPoint/nav a) của EPUB.
        // Những trang KHÔNG có mặt trong Mục lục (ảnh minh hoạ chen giữa chương, trang bìa, trang
        // lời tựa/bản quyền, hoặc phần "chương bị nhà làm ebook cắt tiếp sang file kế" như
        // "x12_02p.xhtml" / "x13_02_2.xhtml" trong ví dụ đã gặp) trước đây bị coi là 1 "chương"
        // riêng biệt => Mục lục có 21 mục nhưng bị tách vụn thành 33+ file. Đánh dấu hasToc=false
        // cho các trang này để bước sau GỘP chúng vào đúng chương thật liền trước, thay vì tạo
        // chương giả.
        if (fileToc && fileToc.length > 0) {
            const MARKER = "___EPUB_CHAPTER_SPLIT_MARKER___";
            let hasMarkers = false;
            for (let i = 0; i < fileToc.length; i++) {
                const t = fileToc[i];
                if (t.fragment) {
                    const el = htmlDoc.getElementById(t.fragment) || htmlDoc.querySelector(`[name="${t.fragment}"]`);
                    if (el) {
                        const markerNode = htmlDoc.createTextNode(`\n\n${MARKER}\n\n${t.title}\n\n${MARKER}\n\n`);
                        el.parentNode?.insertBefore(markerNode, el);
                        hasMarkers = true;
                    }
                }
            }
            
            let rawText = htmlDoc.body ? htmlDoc.body.textContent : (htmlDoc.documentElement.textContent || "");
            rawText = rawText?.replace(/\n\s*\n/g, '\n\n').trim() || "";
            
            if (hasMarkers) {
                const parts = rawText.split(MARKER);
                const extracted: { rawText: string, extractedTitle: string, hasToc: boolean }[] = [];
                
                if (parts[0].trim()) {
                    const title = fileToc[0].fragment ? "Phần đầu" : fileToc[0].title;
                    extracted.push({ rawText: parts[0].trim(), extractedTitle: title, hasToc: true });
                }
                
                for (let i = 1; i < parts.length; i += 2) {
                    const title = parts[i];
                    const text = parts[i+1]?.trim() || "";
                    if (text) {
                        extracted.push({ rawText: text, extractedTitle: title, hasToc: true });
                    }
                }
                return extracted;
            } else {
                const extractedTitle = fileToc[0]?.title || htmlDoc.querySelector("title")?.textContent?.trim() || htmlDoc.querySelector("h1")?.textContent?.trim();
                return [{ rawText, extractedTitle, hasToc: true }];
            }
        } else {
            let rawText = htmlDoc.body ? htmlDoc.body.textContent : (htmlDoc.documentElement.textContent || "");
            rawText = rawText?.replace(/\n\s*\n/g, '\n\n').trim() || "";
            if (!rawText) return null;
            let extractedTitle = htmlDoc.querySelector("title")?.textContent?.trim();
            if (!extractedTitle) extractedTitle = htmlDoc.querySelector("h1")?.textContent?.trim();
            return [{ rawText, extractedTitle, hasToc: false }];
        }
    });
    const contents = await Promise.all(contentPromises);
    contents.forEach((dataArray) => {
        if (dataArray) {
            dataArray.forEach(data => {
                if (data && data.rawText) orderedExtracts.push(data);
            });
        }
    });
    if (onProgress) {
        const currentCount = Math.min(i + BATCH_SIZE, totalSpine);
        const percent = 20 + Math.round((currentCount / totalSpine) * 60);
        onProgress(currentCount, totalSpine, percent);
    }
    await new Promise(r => setTimeout(r, 0));
  }

  // Gộp các trang không có trong Mục lục (minh hoạ chen giữa, phần chương bị ebook-maker cắt
  // tiếp sang file khác, trang bìa/lời tựa...) vào đúng chương thật liền trước, để số chương
  // cuối cùng khớp với Mục lục gốc thay vì bị tách vụn.
  let frontMatterBuffer = "";
  for (const extract of orderedExtracts) {
      if (extract.hasToc) {
          let displayTitle = extract.extractedTitle ? sanitizeFilename(extract.extractedTitle) : `Chương ${rawFiles.length + 1}`;
          if (displayTitle.length > 60) displayTitle = displayTitle.substring(0, 60) + "...";
          const content = frontMatterBuffer ? `${frontMatterBuffer}\n\n${extract.rawText}` : extract.rawText;
          frontMatterBuffer = "";
          const chapterIndex = rawFiles.length + 1;
          rawFiles.push({ id: crypto.randomUUID(), name: `${padNumber(chapterIndex)} ${displayTitle}`, content, translatedContent: null, status: FileStatus.IDLE, retryCount: 0, originalCharCount: content.length, remainingRawCharCount: 0 });
      } else if (rawFiles.length > 0) {
          // Trang mồ côi (không có trong Mục lục) đứng SAU 1 chương thật -> nối tiếp vào chương đó.
          const lastChapter = rawFiles[rawFiles.length - 1];
          lastChapter.content = `${lastChapter.content}\n\n${extract.rawText}`;
          lastChapter.originalCharCount = lastChapter.content.length;
      } else {
          // Trang mồ côi đứng TRƯỚC chương thật đầu tiên (bìa, lời tựa...) -> giữ lại, gộp vào đầu chương đầu tiên.
          frontMatterBuffer = frontMatterBuffer ? `${frontMatterBuffer}\n\n${extract.rawText}` : extract.rawText;
      }
  }
  if (frontMatterBuffer) {
      // Toàn bộ EPUB không có mục nào khớp Mục lục (hiếm) -> đưa phần mồ côi thành 1 chương riêng.
      const chapterIndex = rawFiles.length + 1;
      rawFiles.push({ id: crypto.randomUUID(), name: `${padNumber(chapterIndex)} Mở đầu`, content: frontMatterBuffer, translatedContent: null, status: FileStatus.IDLE, retryCount: 0, originalCharCount: frontMatterBuffer.length, remainingRawCharCount: 0 });
  }

  const hasHugeFile = rawFiles.some(f => f.content.length > 10000);
  const avgChars = rawFiles.length > 0 ? rawFiles.reduce((a,b)=>a+b.content.length,0)/rawFiles.length : 0;
  const needsSplit = hasHugeFile || (rawFiles.length > 10 && avgChars < 300);
  if (onProgress) onProgress(totalSpine, totalSpine, 100);
  return { files: rawFiles, info: { title: metadataTitle, author: metadataAuthor }, coverBlob, needsSplit };
};
