export const FOREIGN_CHARS_REGEX = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0400-\u04ff\u0e00-\u0e7f]/;
export const BATCH_MISSING_TAG_WARNING = "::: [HỆ THỐNG CẢNH BÁO: AI QUÊN TAG PHÂN TÁCH] :::";
export const UPPER_VI = 'A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ';
export const LOWER_VI = 'a-zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ';

export interface LineContext {
  index: number;
  originalLine: string;
}
