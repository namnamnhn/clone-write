import type { FileItem } from '../../types';

const normalizedError = (file: Pick<FileItem, 'errorMessage'>): string =>
    (file.errorMessage || '').toLocaleLowerCase('vi');

export const isPendingTriageVerification = (file: Pick<FileItem, 'errorMessage' | 'translatedContent'>): boolean => {
    const message = normalizedError(file);
    return !!file.translatedContent && message.includes('chưa xác định được') && message.includes('hậu kiểm');
};

export const isSafetyOrSuspiciousError = (file: Pick<FileItem, 'errorMessage'>): boolean => {
    const message = normalizedError(file);
    return ['nghi vấn lỗi nội dung', 'lỗi kiểm định ai', 'phân loại riêng', 'an toàn', 'safety', 'blocklist', 'prohibited_content', 'recitation', 'spii']
        .some(marker => message.includes(marker));
};

export const shouldExcludeFromSmartFix = (
    file: Pick<FileItem, 'isRescueLocked' | 'errorMessage' | 'translatedContent'>
): boolean => !!file.isRescueLocked || isPendingTriageVerification(file);
