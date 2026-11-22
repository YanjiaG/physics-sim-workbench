import type { Scene } from '@psw/core';

export interface SavedScene {
  sceneId: string;
  name: string;
  modelId: string;
  updatedAt: string;
  scene: Scene;
}

const DB_NAME = 'physics-sim-workbench';
const STORE = 'scenes';
const LS_KEY = 'psw.scenes.v1';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'sceneId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

function readFallback(): SavedScene[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedScene[]) : [];
  } catch {
    return [];
  }
}

function writeFallback(items: SavedScene[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {
    /* 存储不可用时静默降级 */
  }
}

export async function listScenes(): Promise<SavedScene[]> {
  const db = await openDb();
  if (!db) return readFallback();
  return new Promise((resolve) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => {
      const items = (request.result as SavedScene[]).slice();
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(items);
    };
    request.onerror = () => resolve(readFallback());
  });
}

export async function putScene(scene: Scene): Promise<void> {
  const record: SavedScene = {
    sceneId: scene.sceneId,
    name: scene.name,
    modelId: scene.modelId,
    updatedAt: scene.updatedAt,
    scene,
  };
  const db = await openDb();
  if (!db) {
    const items = readFallback().filter((item) => item.sceneId !== scene.sceneId);
    items.unshift(record);
    writeFallback(items);
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function deleteScene(sceneId: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    writeFallback(readFallback().filter((item) => item.sceneId !== sceneId));
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(sceneId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
