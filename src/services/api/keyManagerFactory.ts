// TÁI CẤU TRÚC: KeyManager của các dịch vụ vệ tinh (trước đây là bản sao chép y hệt ở nhiều
// nơi - sửa một lỗi xoay vòng key phải nhớ sửa đủ cả các nơi). Factory này chứa bản triển khai
// duy nhất; mỗi dịch vụ chỉ còn khai báo singleton với nhãn hiển thị + danh sách từ khoá
// lỗi-quota đặc thù của mình.
export interface ApiKeyStatus {
    key: string;
    index: number;
    maskedKey: string;
    status: 'Active' | 'Exhausted' | 'Error' | 'Pending';
    successCount: number;
}

type EventCallback = () => void;

class ApiKeyManager {
    private label: string;
    private quotaMarkers: string[];
    private originalKeyStr: string = "";
    private keys: string[] = [];
    private currentIndex: number = 0;
    private keyStatuses: Map<string, ApiKeyStatus> = new Map();
    private subscribers: Set<EventCallback> = new Set();
    private isRotating: boolean = false;

    constructor(label: string, quotaMarkers: string[]) {
        this.label = label;
        this.quotaMarkers = quotaMarkers;
    }

    public syncKeys(apiKeyStr: string) {
        if (this.originalKeyStr === apiKeyStr) return;
        this.originalKeyStr = apiKeyStr;
        const newKeys = apiKeyStr.split(/[,\n]/).map(k => k.trim()).filter(Boolean);

        this.keys = newKeys;
        this.keyStatuses.clear();
        this.keys.forEach((key, idx) => {
            // fix65 (bảo mật hiển thị): trước đây mask giữ nguyên 8 ký tự ĐẦU key — lộ gần nửa
            // chiều dài thực (key DeepSeek ~35 ký tự) trên màn hình. Chỉ hiển thị 4 ký tự CUỐI.
            const masked = key.length > 12 ? '••••••' + key.substring(key.length - 4) : 'Invalid Key';
            this.keyStatuses.set(key, {
                key: key,
                index: idx,
                maskedKey: masked,
                status: idx === 0 ? 'Active' : 'Pending',
                successCount: 0
            });
        });
        this.currentIndex = 0;
        this.notify();
    }

    public getKeys(): string[] {
        return this.keys;
    }

    public getKeyStatuses(): ApiKeyStatus[] {
        return this.keys.map(k => this.keyStatuses.get(k)!);
    }

    public getCurrentKeyInfo(): ApiKeyStatus | null {
        if (this.keys.length === 0) return null;
        return this.keyStatuses.get(this.keys[this.currentIndex]) || null;
    }

    public getCurrentKey(): string {
        if (this.keys.length === 0) return "";
        return this.keys[this.currentIndex];
    }

    public switchToKey(index: number) {
        if (index >= 0 && index < this.keys.length) {
            // Reset previous active to pending if it wasn't exhausted/error
            const prevKey = this.keys[this.currentIndex];
            const prevStatus = this.keyStatuses.get(prevKey);
            if (prevStatus && prevStatus.status === 'Active') {
                prevStatus.status = 'Pending';
            }

            this.currentIndex = index;
            const newKey = this.keys[this.currentIndex];
            const newStatus = this.keyStatuses.get(newKey);
            if (newStatus) {
                newStatus.status = 'Active';
                newStatus.successCount = 0; // reset for this run
            }
            this.notify();
        }
    }

    public rotateToNext(): boolean {
        if (this.keys.length <= 1) return false;
        if (this.isRotating) return false;

        this.isRotating = true;
        const prevKey = this.keys[this.currentIndex];
        const prevStatus = this.keyStatuses.get(prevKey);
        if (prevStatus && prevStatus.status === 'Active') {
            prevStatus.status = 'Exhausted';
        }

        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        const newKey = this.keys[this.currentIndex];
        const newStatus = this.keyStatuses.get(newKey);

        // If we looped around and all are exhausted, we might want to reset them all to Pending and try again
        let allExhausted = true;
        for (const [, st] of this.keyStatuses) {
            if (st.status !== 'Exhausted' && st.status !== 'Error') {
                allExhausted = false;
                break;
            }
        }

        if (allExhausted) {
            console.log(`All ${this.label} keys exhausted. Resetting statuses.`);
            for (const [, st] of this.keyStatuses) {
                st.status = 'Pending';
                st.successCount = 0;
            }
        }

        if (newStatus && newStatus.status !== 'Exhausted' && newStatus.status !== 'Error') {
            newStatus.status = 'Active';
        } else if (allExhausted && newStatus) {
            newStatus.status = 'Active';
        }

        this.isRotating = false;
        this.notify();
        return true;
    }

    public reportSuccess() {
        const currentKey = this.keys[this.currentIndex];
        const status = this.keyStatuses.get(currentKey);
        if (status) {
            status.successCount++;
            if (status.status !== 'Active') {
                status.status = 'Active';
            }
            this.notify();
        }
    }

    public reportError(errorMsg: string) {
        const currentKey = this.keys[this.currentIndex];
        const status = this.keyStatuses.get(currentKey);
        if (status) {
            const lowerMsg = errorMsg.toLowerCase();
            const isQuotaError = this.quotaMarkers.some(marker => marker === '429' ? errorMsg.includes('429') : lowerMsg.includes(marker));
            if (isQuotaError) {
                status.status = 'Exhausted';
                this.rotateToNext();
            } else {
                status.status = 'Error';
            }
            this.notify();
        }
    }

    public resetQuota() {
        this.currentIndex = 0;
        this.keys.forEach((key, idx) => {
            const st = this.keyStatuses.get(key);
            if (st) {
                st.status = idx === 0 ? 'Active' : 'Pending';
                st.successCount = 0;
            }
        });
        this.notify();
    }

    public subscribe(callback: EventCallback): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    private notify() {
        this.subscribers.forEach(cb => cb());
    }
}

export const createKeyManager = (label: string, quotaMarkers: string[]): ApiKeyManager =>
    new ApiKeyManager(label, quotaMarkers);
