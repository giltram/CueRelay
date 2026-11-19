const sessionKey = 'cuerelay.draft-tab';
const lockPrefix = 'cuerelay.draft-tab:';
let pageTab: Promise<string> | undefined;

/** Reserve a storage identity for this document's life, even when its workbench is hidden. */
export function draftTab(): Promise<string> {
  return pageTab ??= claimDraftTab();
}

async function claimDraftTab(): Promise<string> {
  const previous = sessionStorage.getItem(sessionKey);
  // A duplicate tab can have a copy of sessionStorage while the original still owns its ID.
  if (previous && await tryClaim(previous)) return previous;
  const id = crypto.randomUUID();
  if (!await tryClaim(id)) throw new Error('Draft tab identity is unavailable');
  sessionStorage.setItem(sessionKey, id);
  return id;
}

function tryClaim(id: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    void navigator.locks.request(lockPrefix + id, { ifAvailable: true, mode: 'exclusive' }, lock => {
      resolve(Boolean(lock));
      if (lock) return new Promise<void>(() => {});
    }).catch(reject);
  });
}

export async function activeDraftTabs(): Promise<Set<string>> {
  const { held } = await navigator.locks.query();
  return new Set(held?.flatMap(({ mode, name }) =>
    mode === 'exclusive' && name?.startsWith(lockPrefix) ? [name.slice(lockPrefix.length)] : []));
}

/** Candidate operations share access. IndexedDB serializes changes to the record. */
export function withInactiveDraftTab<T>(id: string, action: () => Promise<T>): Promise<T | null> {
  return navigator.locks.request(lockPrefix + id, { ifAvailable: true, mode: 'shared' }, lock => lock ? action() : null);
}
