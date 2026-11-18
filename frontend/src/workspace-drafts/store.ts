import type { WorkspaceDraft } from './model';

const databaseName = 'cuerelay-workspace-drafts';
const storeName = 'drafts';
let connection: Promise<DraftStore> | undefined;

export interface DraftStore {
  list(scope: string): Promise<WorkspaceDraft[]>;
  write(record: WorkspaceDraft): Promise<void>;
  remove(id: string): Promise<void>;
  changeCandidate(record: WorkspaceDraft, tabId: string | null): Promise<void>;
}

export function openDraftStore(): Promise<DraftStore> {
  return connection ??= openDatabase().catch(error => { connection = undefined; throw error; });
}

function openDatabase(): Promise<DraftStore> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: 'id' }).createIndex('scope', 'scope');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Draft database is blocked')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); connection = undefined; };
      db.onclose = () => { connection = undefined; };
      resolve(createStore(db));
    };
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Draft transaction was aborted'));
  });
}

function isDraft(record: WorkspaceDraft): boolean {
  return record?.schemaVersion === 1 && record.document?.schema_version === 2
    && typeof record.id === 'string' && typeof record.tabId === 'string' && typeof record.version === 'string'
    && Number.isFinite(new Date(record.updatedAt).getTime())
    && (record.baseRevision === null || Number.isSafeInteger(record.baseRevision))
    && typeof record.document.source === 'string' && Boolean(record.document.script)
    && Array.isArray(record.document.styles) && Array.isArray(record.document.cues)
    && (record.timing === null || (typeof record.timing?.startText === 'string'
      && typeof record.timing.endText === 'string'));
}

function createStore(db: IDBDatabase): DraftStore {
  return {
    async list(scope) {
      const transaction = db.transaction(storeName);
      const request = transaction.objectStore(storeName).index('scope').getAll(scope);
      await complete(transaction);
      return (request.result as WorkspaceDraft[]).filter(isDraft).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async write(record) {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(record);
      await complete(transaction);
    },
    async remove(id) {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(id);
      await complete(transaction);
    },
    async changeCandidate(record, tabId) {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.get(record.id);
      request.onsuccess = () => {
        const current: WorkspaceDraft | undefined = request.result;
        if (!current || current.scope !== record.scope || current.tabId !== record.tabId
          || current.version !== record.version) {
          transaction.abort();
          return;
        }
        if (tabId === null) store.delete(record.id);
        else store.put({ ...current, tabId });
      };
      await complete(transaction);
    },
  };
}
