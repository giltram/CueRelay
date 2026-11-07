import type { MediaManifest } from '../contracts/projects';

/** External file handles need read permission; never request write access. */
export interface VideoFileHandle extends FileSystemFileHandle {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
}
export interface SelectedVideo { file: File; handle?: VideoFileHandle }
export interface InitialVideo extends SelectedVideo { sha256: string }

type PickerWindow = Window & {
  showOpenFilePicker?: (options: { multiple: false }) => Promise<VideoFileHandle[]>;
};

export function supportsVideoFileHandles(): boolean {
  return window.isSecureContext && typeof (window as PickerWindow).showOpenFilePicker === 'function';
}

/** Call directly from the import button's user gesture. Cancellation preserves selection. */
export async function pickVideoFile(): Promise<SelectedVideo | undefined> {
  const [handle] = await (window as PickerWindow).showOpenFilePicker!({ multiple: false });
  return handle ? { file: await handle.getFile(), handle } : undefined;
}

export function videoStorageKey(actorId: number, organizationId: number, projectId: number, media: MediaManifest): string {
  return `${actorId}:${organizationId}:${projectId}:${media.sha256}:${media.size}`;
}

/** Store only handles, scoped to this origin/browser. Resolve writes on transaction completion. */
async function withVideoStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('cuerelay-local-video', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('本机视频记录暂不可用。'));
  });
  database.onversionchange = () => database.close();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('handles', mode);
      const request = action(transaction.objectStore('handles'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('本机视频记录未保存。'));
    });
  } finally { database.close(); }
}

export function readVideoHandle(key: string): Promise<VideoFileHandle | undefined> {
  return withVideoStore('readonly', store => store.get(key));
}

export async function rememberVideoHandle(key: string, handle?: VideoFileHandle): Promise<void> {
  // A successful fallback import must not leave an unrelated stale handle behind.
  if (handle) await withVideoStore('readwrite', store => store.put(handle, key));
  else await withVideoStore('readwrite', store => store.delete(key));
}
