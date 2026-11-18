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
    void navigator.locks.request(lockPrefix + id, { ifAvailable: true }, lock => {
      resolve(Boolean(lock));
      if (lock) return new Promise<void>(() => {});
    }).catch(reject);
  });
}

export async function activeDraftTabs(): Promise<Set<string>> {
  const { held } = await navigator.locks.query();
  return new Set(held?.flatMap(lock => lock.name?.startsWith(lockPrefix) ? [lock.name.slice(lockPrefix.length)] : []));
}

/** Recheck ownership at the moment another tab's draft is moved or deleted. */
export function withInactiveDraftTab<T>(id: string, action: () => Promise<T>): Promise<T> {
  return navigator.locks.request(lockPrefix + id, { ifAvailable: true }, lock => {
    if (!lock) throw new Error('Another tab is using this draft');
    return action();
  });
}
