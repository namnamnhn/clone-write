
const DB_NAME = 'TranslationAppDB';
const STORE_NAME = 'app_session';
const BACKUP_STORE = 'app_backups'; // NÂNG CẤP #10: kho snapshot dự phòng tự động
// NÂNG CẤP (đề xuất mục 4.1): Translation Memory dời từ localStorage sang IndexedDB —
// không còn giới hạn 500 chương (LRU), phù hợp truyện dài. Dùng chung DB/connection với
// session để hưởng singleton initDB đã xử lý cảnh "database locked".
export const TM_STORE = 'app_translation_memory';
const DB_VERSION = 3; // v3: thêm kho app_translation_memory
const MAX_BACKUPS = 5;

let dbInstance: IDBDatabase | null = null;
// FIX (rò connection IndexedDB): nhiều lời gọi initDB() đồng thời trước lần mở đầu tiên từng
// tạo N request indexedDB.open riêng biệt - onsuccess của request sau GHI ĐÈ dbInstance mà
// không close() connection cũ -> rò kết nối và cảnh "database locked" khó đoán. Dùng 1 promise
// mở chung: mọi caller cùng lúc chia sẻ đúng 1 connection.
let dbInitPromise: Promise<IDBDatabase> | null = null;

// Helper to check if CompressionStream is supported
const isCompressionSupported = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

const compressData = async (data: any): Promise<any> => {
    if (!isCompressionSupported) return data;
    try {
        const jsonString = JSON.stringify(data);
        const stream = new Blob([jsonString]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const response = new Response(compressedStream);
        const buffer = await response.arrayBuffer();
        return { __compressed: true, data: new Uint8Array(buffer) };
    } catch (e) {
        console.warn("Compression failed, falling back to uncompressed data", e);
        return data;
    }
};

const decompressData = async (storedData: any): Promise<any> => {
    if (!storedData || !storedData.__compressed) return storedData;
    if (!isCompressionSupported) {
        throw new Error("Data is compressed but DecompressionStream is not supported in this browser.");
    }
    try {
        const stream = new Blob([storedData.data]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
        const response = new Response(decompressedStream);
        const jsonString = await response.text();
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Decompression failed", e);
        throw e;
    }
};

const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error("IndexedDB Open Error:", (event.target as IDBOpenDBRequest).error);
        reject((event.target as IDBOpenDBRequest).error);
      };

      request.onsuccess = () => {
        dbInstance = request.result;
        
        // Handle connection closing (e.g. adjacent tabs)
        dbInstance.onversionchange = () => {
            dbInstance?.close();
            dbInstance = null;
            dbInitPromise = null;
        };
        dbInstance.onclose = () => {
            dbInstance = null;
        };

        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(BACKUP_STORE)) {
          db.createObjectStore(BACKUP_STORE);
        }
        if (!db.objectStoreNames.contains(TM_STORE)) {
          db.createObjectStore(TM_STORE, { keyPath: 'k' });
        }
      };
      
      // Safety timeout for browsers that lock IDB (like Cốc Cốc sometimes does)
      setTimeout(() => {
          if (request.readyState === 'pending') {
              // Don't reject, just warn. The callback might still happen.
              console.warn("IndexedDB open request is taking longer than expected...");
          }
      }, 3000);

    } catch (e) {
      reject(e);
    }
  });
};

export const initDB = (): Promise<IDBDatabase> => {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (!dbInitPromise) {
    dbInitPromise = openDatabase().catch(e => {
      dbInitPromise = null;
      throw e;
    });
  }
  return dbInitPromise;
};

export const saveToStorage = async (key: string, data: any, retryCount = 0): Promise<void> => {
  try {
    const db = await initDB();
    const dataToStore = await compressData(data);
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(dataToStore, key);

        // Use transaction.oncomplete for better data integrity guarantee
        transaction.oncomplete = () => resolve();
        
        transaction.onerror = (event) => {
             console.error("Transaction Error:", (event.target as IDBTransaction).error);
             reject((event.target as IDBTransaction).error);
        };
        
        request.onerror = (event) => {
             // Fallback if transaction error doesn't catch it
             reject((event.target as IDBRequest).error);
        };

      } catch (e) {
        // If transaction fails (e.g. database closed unexpectedly), reset instance and retry once
        console.warn("Transaction creation failed, resetting DB connection...", e);
        dbInstance = null;
        if (retryCount < 1) {
            console.log("Retrying saveToStorage...");
            resolve(saveToStorage(key, data, retryCount + 1));
        } else {
            reject(e);
        }
      }
    });
  } catch (error) {
    console.warn('Lỗi lưu trữ (Storage Error):', error);
    // If error is due to closed connection, try to reset dbInstance for next time
    if (error instanceof Error && (error.name === 'InvalidStateError' || error.message.includes('closed'))) {
        dbInstance = null;
        if (retryCount < 1) {
            console.log("Retrying saveToStorage after init error...");
            return saveToStorage(key, data, retryCount + 1);
        }
    }
    throw error; // Re-throw to let hook handle it
  }
};

export const loadFromStorage = async (key: string): Promise<any> => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            try {
                const decompressed = await decompressData(request.result);
                resolve(decompressed);
            } catch (e) {
                reject(e);
            }
        };
      } catch (e) {
        dbInstance = null;
        reject(e);
      }
    });
  } catch (error) {
    console.error('Lỗi đọc lưu trữ (Load Error):', error);
    throw error; // Throw instead of returning null to distinguish from "not found"
  }
};

/**
 * NÂNG CẤP #10 — Auto-backup: lưu 1 snapshot dữ liệu vào kho 'app_backups'.
 * Tự động prune chỉ giữ MAX_BACKUPS bản gần nhất (sort theo key bk_<timestamp>).
 */
export const saveBackupSnapshot = async (data: any): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(BACKUP_STORE, 'readwrite');
      const store = transaction.objectStore(BACKUP_STORE);
      store.put(data, `bk_${Date.now()}`);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = (keysReq.result as IDBValidKey[]).map(String).sort();
        while (keys.length > MAX_BACKUPS) {
          const oldest = keys.shift()!;
          store.delete(oldest);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    } catch (e) { reject(e); }
  });
};

/** Liệt kê key snapshot (mới nhất trước). Key dạng bk_<timestamp>. */
export const listBackupSnapshotKeys = async (): Promise<string[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(BACKUP_STORE, 'readonly');
      const req = transaction.objectStore(BACKUP_STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String).sort().reverse());
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
};

/** Đọc 1 snapshot (đã tự giải nén gzip nếu có). */
export const loadBackupSnapshot = async (key: string): Promise<any> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(BACKUP_STORE, 'readonly');
      const req = transaction.objectStore(BACKUP_STORE).get(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = async () => {
        try {
          resolve(await decompressData(req.result));
        } catch (e) { reject(e); }
      };
    } catch (e) { reject(e); }
  });
};

/**
 * FIX (khôi phục mất luôn bản dự phòng tự động): xóa CHỈ record phiên làm việc trong kho
 * 'app_session' — KHÔNG đụng vào kho 'app_backups' (5 snapshot dự phòng tự động) lẫn
 * 'app_translation_memory'. Dùng thay cho clearDatabase() ở luồng Khôi Phục Backup: trước đây
 * restore xoá SẠCH cả DB trước khi ghi dữ liệu mới, nên khôi phục nhầm backup cũ = mất luôn
 * toàn bộ snapshot dự phòng của công việc gần nhất (lưới an toàn bị phá đúng lúc cần nhất).
 */
export const clearSessionRecord = async (key: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    } catch (e) { reject(e); }
  });
};

/**
 * Reset App V4: Soft Reset Support
 * Đóng kết nối và xóa Database.
 * Resolve promise ngay cả khi blocked để UI không bị treo.
 */
export const clearDatabase = async (): Promise<void> => {
  // 1. Cưỡng chế đóng kết nối hiện tại để nhả khóa
  if (dbInstance) {
    try {
        dbInstance.close();
    } catch { /* ignore */ }
    dbInstance = null;
  }
  dbInitPromise = null;
  
  return new Promise((resolve) => {
    let isResolved = false;
    const safeResolve = () => {
        if (!isResolved) {
            isResolved = true;
            resolve();
        }
    };

    // Timeout after 1.5 seconds to prevent hanging
    setTimeout(() => {
        if (!isResolved) {
            console.warn("DB Delete Timed Out - Forcing Continue");
            safeResolve();
        }
    }, 1500);

    try {
      const req = window.indexedDB.deleteDatabase(DB_NAME);
      
      req.onsuccess = () => safeResolve();
      req.onerror = () => {
          console.warn("DB Delete Error (Ignored)");
          safeResolve();
      };
      req.onblocked = () => {
          console.warn("DB Delete Blocked (Ignored)");
          safeResolve();
      };
    } catch {
      safeResolve();
    }
  });
};
