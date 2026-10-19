import type { SaveDocument } from '@emergency/protocol';

export const AUTOSAVE_ID = 'autosave';
export const PREVIOUS_AUTOSAVE_ID = 'autosave-previous';

export interface SaveRecord {
  id: string;
  name: string;
  createdAt: string;
  scenarioId: string;
  schemaVersion: number;
  tick: number;
  document: SaveDocument;
}

export interface SaveStore {
  list(): Promise<SaveRecord[]>;
  put(record: SaveRecord): Promise<void>;
  delete(id: string): Promise<void>;
  rotateAutosave(record: SaveRecord): Promise<void>;
}

const DATABASE = 'emergency-response';
const STORE = 'saves';

export function describeStorageError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return 'Browser storage is full. Delete a save and try again.';
  }
  if (error instanceof Error && error.message.startsWith('Browser storage')) return error.message;
  return 'Browser storage is unavailable.';
}

export function createMemorySaveStore(): SaveStore {
  const records = new Map<string, SaveRecord>();
  return {
    async list() {
      return [...records.values()];
    },
    async put(record) {
      records.set(record.id, record);
    },
    async delete(id) {
      records.delete(id);
    },
    async rotateAutosave(record) {
      const existing = records.get(AUTOSAVE_ID);
      if (existing) {
        records.set(PREVIOUS_AUTOSAVE_ID, {
          ...existing,
          id: PREVIOUS_AUTOSAVE_ID,
          name: 'Previous recovery',
        });
      }
      records.set(AUTOSAVE_ID, record);
    },
  };
}

export function indexedDbSaveStore(): SaveStore {
  return {
    list: () =>
      request(
        'readonly',
        (store, done) => {
          const query = store.getAll();
          query.onsuccess = () => done(query.result as SaveRecord[]);
        },
        [] as SaveRecord[],
      ),
    put: (record) =>
      request('readwrite', (store, done) => {
        const query = store.put(record);
        query.onsuccess = () => done(undefined);
      }),
    delete: (id) =>
      request('readwrite', (store, done) => {
        const query = store.delete(id);
        query.onsuccess = () => done(undefined);
      }),
    rotateAutosave: (record) =>
      request('readwrite', (store, done) => {
        const query = store.get(AUTOSAVE_ID);
        query.onsuccess = () => {
          const existing = query.result as SaveRecord | undefined;
          if (existing) {
            store.put({ ...existing, id: PREVIOUS_AUTOSAVE_ID, name: 'Previous recovery' });
          }
          store.put(record);
          done(undefined);
        };
      }),
  };
}

const browserStore = indexedDbSaveStore();

export async function listSaves(store: SaveStore = browserStore): Promise<SaveRecord[]> {
  const records = await store.list();
  return records.sort(
    (left, right) =>
      rank(left.id) - rank(right.id) || right.createdAt.localeCompare(left.createdAt),
  );
}

export async function writeManualSave(
  name: string,
  document: SaveDocument,
  store: SaveStore = browserStore,
): Promise<SaveRecord> {
  const trimmed = name.trim() || 'Manual save';
  const record: SaveRecord = {
    id: `manual-${crypto.randomUUID()}`,
    name: trimmed,
    createdAt: new Date().toISOString(),
    scenarioId: document.scenarioId,
    schemaVersion: document.schemaVersion,
    tick: document.tick,
    document,
  };
  await store.put(record);
  return record;
}

export async function writeAutosave(
  document: SaveDocument,
  store: SaveStore = browserStore,
): Promise<void> {
  await store.rotateAutosave({
    id: AUTOSAVE_ID,
    name: 'Autosave',
    createdAt: new Date().toISOString(),
    scenarioId: document.scenarioId,
    schemaVersion: document.schemaVersion,
    tick: document.tick,
    document,
  });
}

export async function deleteSave(id: string, store: SaveStore = browserStore): Promise<void> {
  await store.delete(id);
}

function rank(id: string): number {
  if (id === AUTOSAVE_ID) return 1;
  if (id === PREVIOUS_AUTOSAVE_ID) return 2;
  return 0;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Browser storage is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE))
        database.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageFailure(request.error));
  });
}

function request<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void) => void,
  fallback?: T,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        let value = fallback as T;
        run(transaction.objectStore(STORE), (next) => {
          value = next;
        });
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = () => reject(storageFailure(transaction.error));
        transaction.onabort = () => reject(storageFailure(transaction.error));
      }),
    (error: unknown) => Promise.reject(error instanceof Error ? error : storageFailure(error)),
  );
}

function storageFailure(error: unknown): Error {
  return new Error(describeStorageError(error));
}
