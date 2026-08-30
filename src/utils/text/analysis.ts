import { FOREIGN_CHARS_REGEX, LineContext } from './regex';

export const countForeignChars = (text: string): number => {
    if (!text) return 0;
    const matches = text.match(/[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0400-\u04ff\u0e00-\u0e7f]/g);
    return matches ? matches.length : 0;
};

export const findLinesWithForeignChars = (text: string): LineContext[] => {
    if (!text) return [];
    
    const lines = text.split('\n');
    const result: LineContext[] = [];
    
    lines.forEach((line, index) => {
        if (FOREIGN_CHARS_REGEX.test(line)) {
            result.push({ index, originalLine: line });
        }
    });
    
    return result;
};

export const safeJsonParse = (text: string): any => {
    if (!text) return null;
    
    // Attempt 1: Direct parse
    try {
        return JSON.parse(text);
    } catch {}

    // Attempt 2: Extract JSON block
    let jsonStr = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
    } else {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        } else {
            const arrayMatch = text.match(/\[[\s\S]*\]/);
            if (arrayMatch) jsonStr = arrayMatch[0];
        }
    }

    try {
        return JSON.parse(jsonStr);
    } catch {}

    // Attempt 3: Clean up common LLM JSON errors (unescaped control chars)
    try {
        // Replace unescaped newlines and tabs within strings (basic heuristic)
        // A proper parser is complex, but we can just escape all literal newlines/tabs
        // since JSON structure doesn't strictly require literal newlines.
        let cleaned = jsonStr
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
        
        // However, replacing ALL newlines might break structural newlines if the model
        // used them. But JSON.parse actually accepts \n as whitespace outside strings?
        // No, JSON.parse('{\\n"a":"b"\\n}') throws.
        // So we can't just replace all \n with \\n.
        
        // Let's use a regex to only replace newlines inside quotes.
        // This is a simplified regex that might fail on escaped quotes, but works for most cases.
        cleaned = jsonStr.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
            return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
        });
        
        return JSON.parse(cleaned);
    } catch {
        console.warn("safeJsonParse completely failed. Returning null.");
        return null;
    }
};

export const extractPotentialEntities = (text: string): string[] => {
    if (!text) return [];
    const entities = new Set<string>();

    const bracketRegex = /[【\[《「『]([^】\]》」』\n]{1,30})[】\]》」』]/g;
    let match;
    while ((match = bracketRegex.exec(text)) !== null) {
        if (match[1].trim().length > 1) {
            entities.add(match[1].trim());
        }
    }

    const capitalizedRegex = /(?:[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ][a-zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]*\s+){1,4}[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ][a-zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]*/g;
    while ((match = capitalizedRegex.exec(text)) !== null) {
        const entity = match[0].trim();
        const ignoreList = ["Tuy nhiên", "Mặc dù", "Bởi vì", "Nhưng mà", "Thế nhưng", "Lúc này", "Sau khi", "Trước khi", "Đột nhiên", "Bất quá", "Kỳ thật", "Đúng lúc"];
        if (!ignoreList.includes(entity) && entity.length > 2) {
            entities.add(entity);
        }
    }

    const titleRegex = /(?:Tông chủ|Trưởng lão|Thành chủ|Thiếu gia|Sư tôn|Sư phụ|Đại ca|Huynh đệ|Tiền bối|Hậu bối|Đạo hữu|Gia chủ|Thánh nữ|Thánh tử|Hoàng đế|Công chúa|Hoàng tử|Vương gia|Sư huynh|Sư tỷ|Sư muội|Sư đệ)\s+([A-ZÀ-Ỹ][a-zà-ỹ]*)/g;
    while ((match = titleRegex.exec(text)) !== null) {
        if (match[1].trim().length > 1) {
            entities.add(match[1].trim());
        }
    }

    return Array.from(entities);
};
