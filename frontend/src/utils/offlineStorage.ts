/**
 * Cơ chế lưu trữ offline (IndexedDB / LocalStorage)
 * Đảm bảo dữ liệu bảng vẽ và ảnh chụp snapshot không bị mất khi phòng học mất mạng
 * Phụ trách: Hoàng Minh Nghĩa (Frontend)
 */

const OFFLINE_SNAPSHOT_KEY = 'canvas_offline_snapshots';

export interface OfflineSnapshot {
  id: string;
  sessionId: string;
  pageNumber: number;
  imageBase64: string;
  timestamp: number;
}

export const offlineStorage = {
  saveOfflineSnapshot(snapshot: OfflineSnapshot) {
    try {
      const existing: OfflineSnapshot[] = JSON.parse(
        localStorage.getItem(OFFLINE_SNAPSHOT_KEY) || '[]'
      );
      existing.push(snapshot);
      localStorage.setItem(OFFLINE_SNAPSHOT_KEY, JSON.stringify(existing));
    } catch (e) {
      console.warn('Không thể lưu snapshot offline vào LocalStorage:', e);
    }
  },

  getPendingSnapshots(): OfflineSnapshot[] {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_SNAPSHOT_KEY) || '[]');
    } catch {
      return [];
    }
  },

  clearPendingSnapshots() {
    localStorage.removeItem(OFFLINE_SNAPSHOT_KEY);
  },
};
