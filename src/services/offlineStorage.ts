import { DriverLocation } from '../types';

export interface QueuedGpsPoint extends DriverLocation {
  driverId: string;
  localId?: number;
  createdAt: number;
}

const DB_NAME = 'ontime_fleet_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_telemetry';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'localId', autoIncrement: true });
        store.createIndex('driverId', 'driverId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeOfflineGpsPoint(point: DriverLocation & { driverId: string }): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Get current records to check for duplicates and enforce capacity
    const getAllReq = store.getAll();
    const existingPoints: QueuedGpsPoint[] = await new Promise((res, rej) => {
      getAllReq.onsuccess = () => res(getAllReq.result || []);
      getAllReq.onerror = () => rej(getAllReq.error);
    });

    // Deduplication check: ignore if a point for the same driver exists within 1.5 seconds and < 5 meters
    const isDuplicate = existingPoints.some((p) => {
      if (p.driverId !== point.driverId) return false;
      const timeDiff = Math.abs(p.timestamp - point.timestamp);
      const coordDiff = Math.abs(p.lat - point.lat) + Math.abs(p.lng - point.lng);
      return timeDiff < 1500 || coordDiff < 0.00005;
    });

    if (isDuplicate) {
      return;
    }

    // Capacity control: if queue > 300 points, delete oldest
    if (existingPoints.length >= 300) {
      existingPoints.sort((a, b) => a.timestamp - b.timestamp);
      const toPrune = existingPoints.slice(0, existingPoints.length - 280);
      for (const p of toPrune) {
        if (p.localId) store.delete(p.localId);
      }
    }

    const record: QueuedGpsPoint = {
      ...point,
      createdAt: Date.now(),
    };

    store.add(record);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    // Fallback to localStorage if IndexedDB has issues
    try {
      const existingRaw = localStorage.getItem('ontime_offline_gps') || '[]';
      const parsed: QueuedGpsPoint[] = JSON.parse(existingRaw);

      const isDuplicate = parsed.some((p) => {
        if (p.driverId !== point.driverId) return false;
        return Math.abs(p.timestamp - point.timestamp) < 1500;
      });

      if (!isDuplicate) {
        parsed.push({ ...point, createdAt: Date.now() });
        if (parsed.length > 300) parsed.shift();
        localStorage.setItem('ontime_offline_gps', JSON.stringify(parsed));
      }
    } catch {
      // Ignore fallback error
    }
  }
}

export async function getOfflineGpsQueueCount(): Promise<number> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();
    return new Promise((resolve) => {
      countReq.onsuccess = () => resolve(countReq.result || 0);
      countReq.onerror = () => resolve(0);
    });
  } catch {
    try {
      const existingRaw = localStorage.getItem('ontime_offline_gps') || '[]';
      return JSON.parse(existingRaw).length;
    } catch {
      return 0;
    }
  }
}

export async function getQueuedOfflineGpsPoints(): Promise<QueuedGpsPoint[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const points = (request.result || []) as QueuedGpsPoint[];
        // Sort chronologically
        points.sort((a, b) => a.timestamp - b.timestamp);
        resolve(points);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    try {
      const existingRaw = localStorage.getItem('ontime_offline_gps') || '[]';
      return JSON.parse(existingRaw);
    } catch {
      return [];
    }
  }
}

export async function removeSyncedOfflineGpsPoints(localIds: number[]): Promise<void> {
  if (localIds.length === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const id of localIds) {
      store.delete(id);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.removeItem('ontime_offline_gps');
    } catch {
      // Ignore
    }
  }
}
