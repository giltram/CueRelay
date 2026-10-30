import { diagnosticId } from './identifier';
import { LIMITS, type Fence, type StoredEvent } from './schema';
export class FenceChanged extends Error {}
export interface DiagnosticStorage {
  identify(owner: string, current?: () => boolean): Promise<Fence>;
  check?(fence: Fence): Promise<boolean>;
  batch(fence: Fence, events: StoredEvent[]): Promise<{ events: StoredEvent[]; evicted: number }>;
}
const equal = (a: Fence, b: Fence) => a.owner === b.owner && a.epoch === b.epoch;

/** Single database/control row serializes account switches with writes/exports across tabs. */
export class IndexedDiagnosticStorage implements DiagnosticStorage {
  private connection?: Promise<IDBDatabase>;
  private open() {
    return this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('cuerelay-diagnostics-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('control');
        request.result.createObjectStore('events', { keyPath: 'id' });
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(new Error('storage_unavailable'));
      request.onblocked = () => reject(new Error('storage_blocked'));
    });
  }
  private async transaction<T>(run: (control: IDBObjectStore, events: IDBObjectStore, done: (result: T) => void, fail: (reason: Error) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['control', 'events'], 'readwrite');
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(new Error('storage_failed'));
      run(tx.objectStore('control'), tx.objectStore('events'), value => { result = value; }, error => { reject(error); tx.abort(); });
    });
  }
  identify(owner: string, current?: () => boolean): Promise<Fence> {
    return this.transaction((control, events, done, fail) => {
      const request = control.get('active');
      request.onsuccess = () => {
        if (current && !current()) { fail(new FenceChanged()); return; }
        let fence = request.result as Fence | undefined;
        if (!fence || fence.owner !== owner) {
          fence = { owner, epoch: diagnosticId() }; events.clear(); control.put(fence, 'active');
        }
        done(fence);
      };
    });
  }
  async check(fence: Fence): Promise<boolean> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('control', 'readonly');
      const request = tx.objectStore('control').get('active');
      request.onsuccess = () => resolve(Boolean(request.result && equal(request.result, fence)));
      request.onerror = () => reject(new Error('storage_unavailable'));
    });
  }
  batch(fence: Fence, incoming: StoredEvent[]) {
    return this.transaction<{ events: StoredEvent[]; evicted: number }>((control, events, done, fail) => {
      const request = control.get('active');
      request.onsuccess = () => {
        if (!request.result || !equal(request.result, fence)) { fail(new FenceChanged()); return; }
        // Cursor reads one bounded row at a time. No unbounded getAll or document snapshots.
        const rows: StoredEvent[] = [];
        let bytes = 0, evicted = 0;
        const cutoff = Date.now() - LIMITS.ageMs;
        for (const row of incoming) events.put(row);
        const cursor = events.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) { done({ events: rows, evicted }); return; }
          const row = item.value as StoredEvent;
          if (!equal(row.fence, fence) || Date.parse(row.event.timestamp) < cutoff || row.bytes > LIMITS.eventBytes) {
            item.delete(); evicted++;
          } else {
            rows.push(row); bytes += row.bytes;
            // IDs start with timestamp, so eviction is chronological across page sessions.
            while (rows.length > LIMITS.events || bytes > LIMITS.bytes) {
              const removed = rows.shift()!; bytes -= removed.bytes; events.delete(removed.id); evicted++;
            }
          }
          item.continue();
        };
      };
    });
  }
}
