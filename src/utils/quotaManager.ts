
import { ModelQuota, ModelUsage } from '../types';
import { MODEL_CONFIGS } from '../constants';

const STORAGE_KEY = 'gemini_quota_usage_v1';
const SAFETY_BUFFER_MS = 5000; // Tăng lên 5s để đảm bảo an toàn tuyệt đối cho RPM thấp

// ============================================================================
// QUOTA-PER-KEY (fix65, ban đầu CHỈ bật cho bản Lite qua cờ perKeyEnabled = IS_LITE):
// trước đây toàn bộ trạng thái quota/depleted/cooldown của 1 model Gemini là DÙNG
// CHUNG cho MỌI API key cá nhân người dùng đã nhập. Hệ quả khi dùng nhiều key: chỉ
// cần 1 key hết quota/dính 429 là CẢ MODEL bị đánh dấu cạn/chờ — các key còn nguyên
// quota bị "đì" theo tới nửa đêm, và luồng điều phối tải cứ chờ xen kẽ vô ích dù còn
// key rảnh.
//
// FIX69 (mở rộng sang bản Full 6 Tháng/1 Năm): trước đây bản Full luôn gọi
// registerApiKeys([]) (mảng rỗng ép cứng từ gemini.ts) nên perKeyEnabled dù có bật
// cũng không có key nào để xoay vòng. Giờ bản Full đăng ký ĐÚNG hồ bơi hiệu lực của
// nó (key mặc định nhúng qua biến môi trường build + mọi key cá nhân người dùng
// thêm — xem gemini.ts) nên per-key quota/cooldown/depleted/round-robin có ý nghĩa
// thật ở CẢ 2 bản: cờ perKeyEnabled không còn khoá cứng theo IS_LITE nữa, luôn bật.
// Trường hợp thoái hoá về 1 key duy nhất (Full chưa thêm key cá nhân, hồ bơi chỉ có
// key mặc định) vẫn hoạt động đúng — per-key với 1 phần tử tương đương chế độ dùng
// chung cũ, không có khác biệt hành vi với người dùng phổ thông.
//
// Sổ sách per-key lưu theo id OPAQUE của key (hash + 4 ký tự cuối do gemini.ts
// cấp) — TUYỆT ĐỐI không lưu raw API key vào localStorage.
// ============================================================================
const PER_KEY_STORAGE_KEY = 'gemini_quota_per_key_v1';

interface PerKeyUsage {
    requestsToday: number;
    lastResetDate: string;
    cooldownUntil: number;
    isDepleted: boolean;
    consecutiveQuotaErrors: number;
}

const createEmptyPerKeyUsage = (): PerKeyUsage => ({
    requestsToday: 0,
    lastResetDate: '',
    cooldownUntil: 0,
    isDepleted: false,
    consecutiveQuotaErrors: 0,
});

// FIX: ngày "hôm nay" theo MÚI GIỜ ĐỊA PHƯƠNG thay vì UTC. Trước đây dùng
// toISOString().split('T')[0] (ngày UTC) khiến bộ đếm requestsToday/cờ isDepleted của
// user múi giờ +7 chỉ được reset khi đã 07:00 sáng giờ địa phương — ai hết quota RPD từ
// tối hôm trước bị chặn oan thêm ~7 tiếng vào sáng hôm sau. Ghép y/m/d từ các thành phần
// local của Date để ngày đổi đúng nửa đêm địa phương.
const getLocalDateString = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

class QuotaManager {
  private usage: Record<string, ModelUsage> = {};
  private listeners: (() => void)[] = [];
  // Store configs internally so they can be updated dynamically
  private currentConfigs: ModelQuota[] = [...MODEL_CONFIGS];
  
  // Track enabled models dynamically
  private enabledModels: Set<string> = new Set(MODEL_CONFIGS.map(m => m.id));

  // NEW: Track the last model assigned to enforce rotation
  private lastAllocatedId: string | null = null;

  // --- QUOTA-PER-KEY (fix65, mở rộng sang bản Full ở fix69) ---
  // fix69: luôn bật cho CẢ 2 bản — hồ bơi key hiệu lực (gemini.ts) quyết định thực tế có
  // bao nhiêu key để xoay vòng, không còn khoá cứng theo IS_LITE tại đây nữa.
  private perKeyEnabled: boolean = true;
  private apiKeyIds: string[] = [];
  private perKey: Record<string, PerKeyUsage> = {};
  private perKeyCursor: number = 0;

  constructor() {
    this.loadUsage();
    this.loadPerKeyUsage();
  }

  // --- QUOTA-PER-KEY: API chính ---
  /** Test-only: cho phép mô phỏng cả 2 chế độ (bật/tắt per-key) trong test. Runtime luôn khởi tạo = true (fix69). */
  public __setPerKeyEnabledForTests(v: boolean) { this.perKeyEnabled = v; }

  public isPerKeyActive(): boolean {
      return this.perKeyEnabled && this.apiKeyIds.length > 0;
  }

  /**
   * Đăng ký danh sách id key (đã hash, không chứa raw key) do gemini.ts cấp khi người dùng
   * sửa danh sách key cá nhân. State của key bị xoá sẽ được dọn bỏ; state các key còn lại
   * GIỮ NGUYÊN (không reset oan khi người dùng chỉ thêm/bớt 1 key giữa chừng).
   */
  public registerApiKeys(ids: string[]) {
      // Khi per-key TẮT (bản Full): chỉ ghi nhận danh sách để getApiKeyIds phản ánh đúng
      // thực tế, KHÔNG prune/không lưu persistence — mọi cơ chế per-key vẫn no-op.
      if (!this.perKeyEnabled) {
          this.apiKeyIds = [...ids];
          return;
      }
      this.apiKeyIds = [...ids];
      const alive = new Set(ids);
      for (const k of Object.keys(this.perKey)) {
          const keyId = k.split('|')[0];
          if (!alive.has(keyId)) delete this.perKey[k];
      }
      this.perKeyCursor = 0;
      this.savePerKeyUsage();
  }

  public getApiKeyIds(): string[] {
      return [...this.apiKeyIds];
  }

  /** Composite key 'keyId|modelId' cho sổ per-key. */
  private perKeyEntry(keyId: string, modelId: string): PerKeyUsage {
      const composite = `${keyId}|${modelId}`;
      let entry = this.perKey[composite];
      if (!entry) {
          entry = createEmptyPerKeyUsage();
          this.perKey[composite] = entry;
      }
      // Lật ngày mới lười (lazy) — cùng semantics với maybeRollDailyUsage của sổ model.
      const today = getLocalDateString();
      if (entry.lastResetDate !== today) {
          entry.requestsToday = 0;
          entry.cooldownUntil = 0;
          entry.isDepleted = false;
          entry.consecutiveQuotaErrors = 0;
          entry.lastResetDate = today;
      }
      return entry;
  }

  /**
   * Chọn 1 key đang usable cho model: chưa depleted, chưa chạm RPD riêng, không đang cooldown.
   * Xoay vòng round-robin để dàn đều. Nếu tất cả key usable đều đang cooldown ngắn -> chọn key
   * còn ít thời gian chờ nhất (vẫn tốt hơn đứng chết chỗ); nếu TẤT CẢ đã cạn -> null.
   */
  public pickApiKeyForModel(modelId: string): string | null {
      if (!this.isPerKeyActive()) return null;
      const config = this.currentConfigs.find(m => m.id === modelId);
      const rpdLimit = config ? config.rpdLimit : Number.POSITIVE_INFINITY;
      const now = Date.now();
      const usable: string[] = [];
      const cooling: { id: string; until: number }[] = [];
      for (const id of this.apiKeyIds) {
          const e = this.perKeyEntry(id, modelId);
          if (e.isDepleted || e.requestsToday >= rpdLimit) continue;
          if (e.cooldownUntil > now) { cooling.push({ id, until: e.cooldownUntil }); continue; }
          usable.push(id);
      }
      if (usable.length > 0) {
          // Xoay vòng đều qua các key usable theo từng lượt gọi
          const idx = this.perKeyCursor % usable.length;
          this.perKeyCursor = (this.perKeyCursor + 1) % 1000000;
          return usable[idx];
      }
      if (cooling.length > 0) {
          cooling.sort((a, b) => a.until - b.until);
          return cooling[0].id;
      }
      return null;
  }

  /**
   * fix65 (per-key): còn key nào NGAY LẬP TỨC dùng được cho model không (chưa cạn, chưa chạm
   * RPD riêng, không đang cooldown)? Dùng để quyết định có cần đưa model vào blacklist tạm
   * hay vẫn còn hy vọng thử key khác trong cùng lượt chạy.
   */
  public hasUsableApiKeyFor(modelId: string): boolean {
      if (!this.isPerKeyActive()) return false;
      const config = this.currentConfigs.find(m => m.id === modelId);
      const rpdLimit = config ? config.rpdLimit : Number.POSITIVE_INFINITY;
      const now = Date.now();
      return this.apiKeyIds.some(id => {
          const e = this.perKeyEntry(id, modelId);
          return !e.isDepleted && e.requestsToday < rpdLimit && e.cooldownUntil <= now;
      });
  }

  /**
   * fix65 (per-key): khoảng chờ ngắn nhất còn lại trước khi CÓ một key dùng được cho model
   * (min cooldown còn lại giữa các key chưa cạn). Trả 0 khi không ở chế độ per-key hoặc đã
   * có key rảnh — giúp vòng "điều phối tải" của smartExecution chờ ĐÚNG thời gian còn thiếu
   * thay vì mặc định 2s rồi dính lại 429 ngay.
   */
  public getApiKeyWaitForModel(modelId: string): number {
      if (!this.isPerKeyActive()) return 0;
      const config = this.currentConfigs.find(m => m.id === modelId);
      const rpdLimit = config ? config.rpdLimit : Number.POSITIVE_INFINITY;
      const now = Date.now();
      let minWait = Number.POSITIVE_INFINITY;
      for (const id of this.apiKeyIds) {
          const e = this.perKeyEntry(id, modelId);
          if (e.isDepleted || e.requestsToday >= rpdLimit) continue;
          minWait = Math.min(minWait, Math.max(0, e.cooldownUntil - now));
      }
      return minWait === Number.POSITIVE_INFINITY ? 0 : minWait;
  }

  private loadPerKeyUsage() {
      try {
          const stored = localStorage.getItem(PER_KEY_STORAGE_KEY);
          if (stored) this.perKey = JSON.parse(stored) || {};
      } catch (e) {
          console.error('Failed to load per-key quota usage', e);
          this.perKey = {};
      }
      // Dọn state của key không còn trong danh sách đăng ký (sau reload trang apiKeyIds rỗng
      // tới khi setUserGeminiKeys chạy lại — giữ nguyên entries, registerApiKeys sẽ prune sau).
  }

  private savePerKeyUsage() {
      try {
          localStorage.setItem(PER_KEY_STORAGE_KEY, JSON.stringify(this.perKey));
      } catch (e) {
          console.error('Failed to save per-key quota usage', e);
      }
      // FIX67: báo UI vẽ lại khi sổ per-key đổi (thanh quota theo key ở Header phụ thuộc vào đó)
      this.notifyListeners();
  }

  /**
   * FIX67 (đề xuất fix65 — hiển thị usage THEO KEY cho bản Lite): tóm tắt trạng thái từng
   * key cá nhân đối với 1 model, để Header vẽ chip "…1234 12/500" dưới thanh quota của model.
   * Trả mảng rỗng khi per-key đang tắt hoặc chưa có key nào đăng ký -> UI tự ẩn, không cần rẽ
   * nhánh theo bản/edition.
   */
  public getPerKeySummary(modelId: string): { label: string; requestsToday: number; rpdLimit: number; isDepleted: boolean }[] {
      if (!this.isPerKeyActive()) return [];
      const config = this.currentConfigs.find(m => m.id === modelId);
      const rpdLimit = config ? config.rpdLimit : 0;
      return this.apiKeyIds.map(id => {
          const e = this.perKeyEntry(id, modelId);
          const used = e.requestsToday || 0;
          return {
              label: '…' + id.slice(-4),
              requestsToday: used,
              rpdLimit,
              isDepleted: e.isDepleted || (rpdLimit > 0 && used >= rpdLimit)
          };
      });
  }

  // Allow App to update configs (e.g. from user edits)
  public updateConfigs(newConfigs: ModelQuota[]) {
    this.currentConfigs = newConfigs;
    this.notifyListeners();
  }
  
  // Update enabled models from UI state
  public setEnabledModels(models: string[]) {
      this.enabledModels = new Set(models);
  }

  public isModelEnabled(modelId: string): boolean {
      return this.enabledModels.has(modelId);
  }

  public getConfigs(): ModelQuota[] {
    return this.currentConfigs;
  }

  // NEW: Expose snapshot for UI Reactivity
  public getUsageSnapshot(): Record<string, ModelUsage> {
      return { ...this.usage };
  }

  public clearUsage() {
      this.usage = {};
      const today = getLocalDateString();
      this.currentConfigs.forEach(model => {
        this.usage[model.id] = {
          requestsToday: 0,
          lastResetDate: today,
          recentRequests: [],
          cooldownUntil: 0,
          isDepleted: false,
          consecutiveErrors: 0,
          consecutiveQuotaErrors: 0
        };
      });
      this.lastAllocatedId = null;
      this.perKey = {}; // fix65: xoá luôn sổ per-key
      try { localStorage.removeItem(PER_KEY_STORAGE_KEY); } catch {}
      this.saveUsage();
  }

  private loadUsage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.usage = JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load quota usage", e);
    }
    
    // Initialize missing models and check for daily reset
    const today = getLocalDateString();
    
    // Use currentConfigs instead of static import
    this.currentConfigs.forEach(model => {
      if (!this.usage[model.id] || this.usage[model.id].lastResetDate !== today) {
        // Reset daily counters
        this.usage[model.id] = {
          requestsToday: 0,
          lastResetDate: today,
          recentRequests: [],
          cooldownUntil: 0,
          isDepleted: false,
          consecutiveErrors: 0,
          consecutiveQuotaErrors: 0
        };
      } else {
          // Ensure fields exist for loaded data
          if (this.usage[model.id].consecutiveErrors === undefined) {
              this.usage[model.id].consecutiveErrors = 0;
          }
          if (this.usage[model.id].consecutiveQuotaErrors === undefined) {
              this.usage[model.id].consecutiveQuotaErrors = 0;
          }
      }
    });
    this.saveUsage();
  }

  private saveUsage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.usage));
      this.notifyListeners();
    } catch (e) {
      console.error("Failed to save quota usage", e);
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(l => l());
  }

  public getModelUsage(modelId: string): ModelUsage {
    return this.usage[modelId];
  }

  /**
   * FIX (quota không reset qua nửa đêm): trước đây việc lật ngày mới chỉ được kiểm tra trong
   * loadUsage() — vốn chỉ chạy ĐÚNG 1 LẦN khi khởi tạo QuotaManager. Với phiên dịch dài chạy
   * xuyên qua 0 giờ (ca sử dụng chính của app), requestsToday/isDepleted/cooldownUntil của
   * ngày hôm trước bị "dính" vĩnh viễn: mọi model báo hết Quota RPD cả buổi sáng hôm sau dù
   * Google đã reset counter, người dùng phải tải lại trang mới hết bị kẹt. Helper này kiểm tra
   * lười (lazy) tại các điểm đọc/quan trọng nhất và tự lật counter sang ngày mới khi phát hiện
   * khác ngày.
   */
  private maybeRollDailyUsage(modelId: string): void {
      const usage = this.usage[modelId];
      if (!usage || usage.lastResetDate === getLocalDateString()) return;
      const today = getLocalDateString();
      this.usage[modelId] = {
          requestsToday: 0,
          lastResetDate: today,
          recentRequests: [],
          cooldownUntil: 0,
          isDepleted: false,
          consecutiveErrors: 0,
          consecutiveQuotaErrors: 0
      };
      this.saveUsage();
  }

  /**
   * Check if a model is completely dead for the day (Hard Quota or Too Many Errors).
   * Does NOT check for RPM (Soft Limit).
   *
   * QUOTA-PER-KEY (fix65, bản Lite): khi đang ở chế độ per-key, model chỉ bị coi là cạn khi
   * TẤT CẢ các key đã đăng ký đều cạn (depleted riêng lẻ hoặc chạm RPD riêng). Ngưỡng
   * requestsToday DÙNG CHUNG không còn là dấu hiệu hết hạn nữa — tổng số request qua nhiều
   * key vượt RPD của 1 key không có nghĩa gì (Google giới hạn theo từng project/key).
   */
  public isModelDepleted(modelId: string): boolean {
      this.maybeRollDailyUsage(modelId);
      const usage = this.usage[modelId];
      const modelConfig = this.currentConfigs.find(m => m.id === modelId);
      if (!usage || !modelConfig) return true;

      // 0. Cờ depleted toàn cục (do nơi KHÔNG có ngữ cảnh key đánh dấu, vd testModelConnection)
      if (usage.isDepleted) return true;

      // 1. Chế độ per-key: tất cả key phải cùng cạn mới coi model là cạn
      if (this.isPerKeyActive()) {
          return this.apiKeyIds.every(id => {
              const e = this.perKeyEntry(id, modelId);
              return e.isDepleted || e.requestsToday >= modelConfig.rpdLimit;
          });
      }

      // 2. Daily limit reached (chế độ dùng chung như cũ)
      if (usage.requestsToday >= modelConfig.rpdLimit) return true;

      return false;
  }

  /**
   * PRECISE SLIDING WINDOW CALCULATION
   * Tính toán chính xác thời gian phải chờ dựa trên lịch sử request.
   */
  public getWaitTimeForModel(modelId: string): number {
      this.maybeRollDailyUsage(modelId);
      const usage = this.usage[modelId];
      const modelConfig = this.currentConfigs.find(m => m.id === modelId);
      
      if (!usage || !modelConfig) return Infinity;
      if (this.isModelDepleted(modelId)) return Infinity;

      const now = Date.now();
      let waitTime = 0;

      // 1. Check Explicit Cooldown (Hard 429 from Google or Error Penalty)
      if (usage.cooldownUntil > now) {
          waitTime = Math.max(waitTime, usage.cooldownUntil - now);
      }

      // 2. Check RPM Sliding Window (Strict Local Limit)
      // Lọc các request trong vòng 60s + buffer
      const windowSize = 60000; 
      const recent = usage.recentRequests.filter(t => now - t < windowSize);
      
      // LOGIC MỚI: Nếu số lượng request GẦN ĐÂY (kể cả vừa mới gọi chưa xong) >= Limit
      if (recent.length >= modelConfig.rpmLimit) {
          // Sắp xếp tăng dần: [T1, T2, T3...] (T1 là cũ nhất)
          const sorted = recent.sort((a, b) => a - b);
          
          // Index của thằng cần "expire" = (Length - Limit)
          const blockingRequestTime = sorted[recent.length - modelConfig.rpmLimit];
          
          if (blockingRequestTime) {
              const timeUntilExpiry = (blockingRequestTime + windowSize) - now;
              if (timeUntilExpiry > 0) {
                  // Thêm SAFETY_BUFFER_MS để chắc chắn Google đã reset counter bên server
                  waitTime = Math.max(waitTime, timeUntilExpiry + SAFETY_BUFFER_MS);
              }
          }
      }
      
      // 3. Cơ chế phục hồi/tránh quá tải (Spaced Out Requests)
      // Đợi chờ giữa các request để rải đều trong 60s, tránh burst 429
      if (recent.length > 0) {
          const lastRequestTime = Math.max(...recent);
          const minSpacing = windowSize / modelConfig.rpmLimit; // VD: rpm=2 -> 30000ms
          const timeSinceLast = now - lastRequestTime;
          if (timeSinceLast < minSpacing) {
              waitTime = Math.max(waitTime, minSpacing - timeSinceLast);
          }
      }

      return waitTime;
  }

  /**
   * Check if a model is currently available for use (WaitTime == 0).
   */
  public isModelAvailable(modelId: string): boolean {
    // 0. Check Enabled State (UI Toggle)
    if (!this.isModelEnabled(modelId)) return false;

    const usage = this.usage[modelId];
    if (!usage) return false;

    // 1. Check Hard Stop (Depleted)
    if (this.isModelDepleted(modelId)) return false;

    // 2. Check Calculated Wait Time
    return this.getWaitTimeForModel(modelId) === 0;
  }

  /**
   * SMART LOAD BALANCER v2.1 (Interleaved Round Robin)
   * Prioritize rotation: If we just used Model A, try hard to use Model B next.
   */
  public getBestModelForTask(candidates: string[], excludedModels: string[] = [], preferredModelId?: string, priorityOverrides?: Record<string, number>): string | null {
      const now = Date.now();
      const windowSize = 60000;

      // 0. Filter Candidates
      const eligibleCandidates = candidates.filter(id => 
          this.isModelEnabled(id) && 
          !this.isModelDepleted(id) &&
          !excludedModels.includes(id)
      );

      if (eligibleCandidates.length === 0) return null;

      // --- STRICT PREFERRED MODEL (Wait if on RPM cooldown, nhưng KHÔNG chờ vô thời hạn) ---
      // If the caller explicitly prefers a model, we try to keep using that model unless it is
      // depleted or stuck too long.
      if (preferredModelId && eligibleCandidates.includes(preferredModelId)) {
          if (this.isModelAvailable(preferredModelId)) {
              return preferredModelId;
          }
          // FIX (báo cáo người dùng): bản gốc LUÔN return null ở đây để bắt smartExecution vòng
          // lặp "Hệ thống đang điều phối tải (Chờ xen kẽ)" mỗi 2s cho tới khi preferred model
          // hết cooldown hoặc cạn hẳn 50 lượt thử (MAX_ITERATIONS trong gemini.ts) rồi báo lỗi
          // "Vượt quá số lần thử tối đa" — dù các model dự phòng CÙNG POOL đang RẢNH HOÀN TOÀN
          // suốt thời gian đó (quan sát thực tế từ log: gemini-3.1-pro-preview dính 429 nhiều
          // lượt liên tiếp trong khi các model Flash dự phòng không hề được thử). Chỉ ép chờ
          // ĐÚNG preferred model khi cooldown còn NGẮN (<=15s — cùng ngưỡng với
          // hasReadyModels() đã dùng sẵn ở nơi khác trong file này); cooldown dài hơn thì rớt
          // xuống chọn 1 model dự phòng đang sẵn sàng ngay bên dưới, để không lãng phí lượt thử
          // hữu hạn của smartExecution chỉ để đợi 1 model đang kẹt RPM lâu.
          const preferredWait = this.getWaitTimeForModel(preferredModelId);
          if (preferredWait <= 15000) {
              return null;
          }
          // Không return ở đây -> để logic "Find Ready Models" bên dưới chọn model dự phòng.
      }

      // 1. Find Ready Models (Wait Time == 0)
      const readyModels = eligibleCandidates.filter(id => this.isModelAvailable(id));

      if (readyModels.length > 0) {
          // --- THUẬT TOÁN LEAST LOADED + ROTATION PENALTY ---
          const modelScores = readyModels.map(id => {
              const usage = this.usage[id];
              const config = this.currentConfigs.find(c => c.id === id);
              if (!usage || !config) return { id, score: 999 };

              const recentCount = usage.recentRequests.filter(t => now - t < windowSize).length;
              
              // Base Score: Priority (dominant) + RPM Load (80%) + RPD Load (20%)
              const rpmLoad = recentCount / Math.max(1, config.rpmLimit);
              const rpdLoad = usage.requestsToday / Math.max(1, config.rpdLimit);
              
              // Nếu có priorityOverrides riêng cho tác vụ này (vd hậu kiểm Tier 2), dùng nó thay
              // vì priority mặc định trong MODEL_CONFIGS — để KHÔNG ảnh hưởng thứ tự ưu tiên
              // dùng cho dịch/Auto-Fix (vốn cũng đọc chung config.priority này).
              const effectivePriority = (priorityOverrides && priorityOverrides[id] !== undefined) ? priorityOverrides[id] : (config.priority || 5);
              const priorityBase = effectivePriority * 100; // Heavily weight by priority
              let score = priorityBase + (rpmLoad * 0.8) + (rpdLoad * 0.2);

              // *** ROTATION PENALTY ***
              if (id === this.lastAllocatedId && readyModels.length > 1) {
                  score += 0.5; // Significant penalty to push it to bottom
              }
              
              return { id, score };
          });

          // Sort: Thấp nhất lên đầu
          modelScores.sort((a, b) => a.score - b.score);
          
          return modelScores[0].id;
      }

      // 2. If no one is ready, return null so the caller (smartExecution) can wait
      return null;
  }

  // --- NEW: Helper for UI to "Reserve" a model so the next concurrent loop picks a different one ---
  public notifyAllocation(modelId: string) {
      this.lastAllocatedId = modelId;
  }

  public hasAvailableModels(modelIds: string[]): boolean {
      return modelIds.some(id => !this.isModelDepleted(id) && this.isModelEnabled(id));
  }

  // Checks if models are available AND not on a long cooldown (>15s)
  public hasReadyModels(modelIds: string[]): boolean {
      return modelIds.some(id => {
          if (!this.isModelEnabled(id) || this.isModelDepleted(id)) return false;
          const usage = this.usage[id];
          if (usage && usage.cooldownUntil > Date.now() + 15000) return false;
          return true;
      });
  }

  // --- CHANGED: Call this BEFORE calling API to reserve slot ---
  public recordRequest(modelId: string) {
    this.maybeRollDailyUsage(modelId);
    const usage = this.usage[modelId];
    if (usage) {
      this.lastAllocatedId = modelId; // Update rotation tracker
      // DO NOT increment requestsToday here to avoid inflating the count on retries
      usage.recentRequests.push(Date.now()); 
      
      // Cleanup old entries
      const now = Date.now();
      usage.recentRequests = usage.recentRequests.filter(t => now - t < 70000);
      
      this.saveUsage();
    }
  }

  // --- NEW: Call this AFTER successful API response ---
  // fix65: keyId (tuỳ chọn) — ở chế độ per-key sẽ cộng thêm bộ đếm RPD RIÊNG của key đó.
  public recordSuccess(modelId: string, apiKeyId?: string) {
      const usage = this.usage[modelId];
      if (usage) {
          usage.requestsToday++; // Increment only on success
          usage.consecutiveErrors = 0; // Reset normal errors
          usage.consecutiveQuotaErrors = 0; // Reset quota errors
          this.saveUsage();
      }
      if (apiKeyId && this.isPerKeyActive()) {
          const e = this.perKeyEntry(apiKeyId, modelId);
          e.requestsToday++;
          e.consecutiveQuotaErrors = 0;
          this.savePerKeyUsage();
      }
  }

  public recordError(modelId: string) {
      const usage = this.usage[modelId];
      if (usage) {
          usage.consecutiveErrors = (usage.consecutiveErrors || 0) + 1;

          // SOFT PENALTY: Force this model to cool down for 30s to let Load Balancer pick another one
          usage.cooldownUntil = Date.now() + 30000;
          this.saveUsage();
      }
  }

  // fix65: đếm lỗi quota LIÊN TIẾP RIÊNG CỦA TỪNG KEY (chế độ per-key) để thang leo thang
  // 5s/10s/15s/1phút/depleted chạy đúng trên key đang gặp vấn đề, không cài lên các key khác.
  public recordQuotaError(modelId: string, apiKeyId?: string) {
      if (apiKeyId && this.isPerKeyActive()) {
          const e = this.perKeyEntry(apiKeyId, modelId);
          e.consecutiveQuotaErrors = (e.consecutiveQuotaErrors || 0) + 1;
          this.savePerKeyUsage();
          return;
      }
      const usage = this.usage[modelId];
      if (usage) {
          usage.consecutiveQuotaErrors = (usage.consecutiveQuotaErrors || 0) + 1;
          this.saveUsage();
      }
  }

  public getConsecutiveQuotaErrorsFor(modelId: string, apiKeyId?: string): number {
      if (apiKeyId && this.isPerKeyActive()) {
          return this.perKeyEntry(apiKeyId, modelId).consecutiveQuotaErrors || 0;
      }
      return this.usage[modelId]?.consecutiveQuotaErrors || 0;
  }

  public getRequestsTodayFor(modelId: string, apiKeyId?: string): number {
      if (apiKeyId && this.isPerKeyActive()) {
          const config = this.currentConfigs.find(m => m.id === modelId);
          const rpdLimit = config ? config.rpdLimit : Number.POSITIVE_INFINITY;
          return Math.min(this.perKeyEntry(apiKeyId, modelId).requestsToday || 0, rpdLimit);
      }
      return this.usage[modelId]?.requestsToday || 0;
  }

  public recordRateLimit(modelId: string, duration: number = 60000, apiKeyId?: string) {
    // fix65: cooldown do 429 là hiện tượng CỦA RIÊNG key bị server từ chối — chế độ per-key
    // chỉ cho key đó nghỉ, các key khác vẫn được điều phối ngay (không chờ oan tập thể).
    if (apiKeyId && this.isPerKeyActive()) {
        const e = this.perKeyEntry(apiKeyId, modelId);
        e.cooldownUntil = Date.now() + duration;
        this.savePerKeyUsage();
        return;
    }
    const usage = this.usage[modelId];
    if (usage) {
      // Explicit cooldown from Server response (Hard 429)
      usage.cooldownUntil = Date.now() + duration;
      this.saveUsage();
    }
  }

  public markAsDepleted(modelId: string, apiKeyId?: string) {
      if (apiKeyId && this.isPerKeyActive()) {
          const e = this.perKeyEntry(apiKeyId, modelId);
          e.isDepleted = true;
          e.cooldownUntil = Date.now() + 600000;
          this.savePerKeyUsage();
          return;
      }
      const usage = this.usage[modelId];
      if (usage) {
          usage.isDepleted = true;
          // Cooldown 10 mins instead of 1 hour for error-based depletion (to allow retry)
          usage.cooldownUntil = Date.now() + 600000;
          this.saveUsage();
      }
  }

  public reset() {
    this.usage = {};
    this.perKey = {}; // fix65
    try { localStorage.removeItem(PER_KEY_STORAGE_KEY); } catch {}
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this.loadUsage();
    this.loadPerKeyUsage();
    this.notifyListeners();
  }

  public resetDailyQuotas() {
    const today = getLocalDateString();
    for (const key in this.usage) {
        this.usage[key] = {
            ...this.usage[key],
            requestsToday: 0,
            isDepleted: false,
            lastResetDate: today,
            consecutiveErrors: 0,
            consecutiveQuotaErrors: 0, // FIX: trước đây thiếu field này — count cũ >= 5 còn sót lại
                                       // sẽ khiến model bị markAsDepleted ngay ở lượt 429 đầu
                                       // tiên của ngày mới (gemini.ts)
            cooldownUntil: 0,
            recentRequests: [] // Reset recent history too
        };
    }
    // fix65 (quota-per-key): lật ngày mới cho toàn bộ sổ per-key
    for (const k of Object.keys(this.perKey)) {
        this.perKey[k] = { ...createEmptyPerKeyUsage(), lastResetDate: today };
    }
    this.savePerKeyUsage();
    this.lastAllocatedId = null; // Reset rotation tracker
    this.saveUsage();
  }
}

export const quotaManager = new QuotaManager();
