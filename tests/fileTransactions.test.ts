import { describe, expect, it } from 'vitest';
import { FileItem, FileStatus } from '../src/types';
import { beginFileTransactions, rollbackAndCloseFileTransactions, rollbackBatchFileTransactions, settleBatchFileTransactions } from '../src/hooks/translator/fileTransactions';
const file = (o: Partial<FileItem> = {}): FileItem => ({ id: 'f1', name: '1.txt', content: '原文', translatedContent: 'Bản cũ', status: FileStatus.COMPLETED, retryCount: 1, originalCharCount: 2, remainingRawCharCount: 0, usedModel: 'old', ...o });
describe('fix76 — transaction theo tệp', () => {
    it('commit khi thành công', () => { const s = new Map(); beginFileTransactions(s, [file()], 1, 'retranslate'); const r = settleBatchFileTransactions([file({ translatedContent: 'Bản mới' })], ['f1'], s, 1); expect(r[0].translatedContent).toBe('Bản mới'); expect(s.size).toBe(0); });
    it('rollback stream nhưng giữ trạng thái retry', () => { const s = new Map(); beginFileTransactions(s, [file()], 2, 'retranslate'); const r = rollbackBatchFileTransactions([file({ translatedContent: 'dở', status: FileStatus.IDLE, errorMessage: '503', retryCount: 2 })], ['f1'], s, 2); expect(r[0]).toMatchObject({ translatedContent: 'Bản cũ', status: FileStatus.IDLE, errorMessage: '503', retryCount: 2 }); expect(s.size).toBe(1); });
    it('rollback đầy đủ khi hủy/repair lỗi', () => { const s = new Map(); beginFileTransactions(s, [file()], 3, 'postprocess'); const r = rollbackAndCloseFileTransactions([file({ translatedContent: 'dở', status: FileStatus.REPAIRING, retryCount: 9 })], ['f1'], s, 3); expect(r[0]).toMatchObject({ translatedContent: 'Bản cũ', status: FileStatus.COMPLETED, retryCount: 1 }); expect(s.size).toBe(0); });
});
