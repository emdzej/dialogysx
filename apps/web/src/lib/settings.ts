/**
 * Where the data came from last time.
 *
 * Two stores, because one will not do. The *choice* is a small JSON object and
 * belongs in `localStorage`; the picked directory is a
 * `FileSystemDirectoryHandle`, which `JSON.stringify` turns into `{}` — it is
 * structured-cloneable but not serialisable, so it has to live in IndexedDB.
 * Writing the handle to `localStorage` does not throw: it stores an empty
 * object, and the folder silently stops being remembered.
 *
 * The other thing a handle brings is **permission**, which does not survive a
 * reload. `queryPermission` reports `"prompt"` on a fresh page even for a
 * handle the user granted yesterday, and `requestPermission` must be called
 * from a user gesture. So a remembered folder cannot be reopened silently on
 * boot; the interface has to offer a button. An HTTP tree has no such
 * restriction and reopens on its own.
 */

/** What the app should open on boot. */
export type SavedSource =
  | { kind: "http"; url: string }
  /** `name` is for the interface; the handle itself is in IndexedDB. */
  | { kind: "folder"; name: string };

export interface Settings {
  source?: SavedSource;
  /** Language the user last chose, if the tree offered a choice. */
  language?: string;
}

const KEY = "dialogysx.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Settings;
    // Validate rather than trust: this is user-editable storage, and a
    // half-written object here would fail much later, when something tried to
    // open `undefined` as a URL.
    if (parsed.source?.kind === "http" && typeof parsed.source.url !== "string") return {};
    if (parsed.source?.kind === "folder" && typeof parsed.source.name !== "string") return {};
    return parsed;
  } catch {
    // Private-mode Safari throws on `localStorage` access rather than
    // returning null, and a corrupt value throws in `JSON.parse`. Neither is
    // worth failing to start over.
    return {};
  }
}

export function saveSettings(next: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the app still works, it just will not remember.
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; see above.
  }
}

// --------------------------------------------------------------------------
// the directory handle
// --------------------------------------------------------------------------

const DB_NAME = "dialogysx";
const DB_VERSION = 1;
const STORE = "handles";
const HANDLE_KEY = "dataDirectory";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return undefined;
  }
  try {
    return await new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } finally {
    db.close();
  }
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore("readwrite", (s) => s.put(handle, HANDLE_KEY) as IDBRequest<IDBValidKey>);
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return await withStore<FileSystemDirectoryHandle>("readonly", (s) => s.get(HANDLE_KEY));
}

export async function clearDirectoryHandle(): Promise<void> {
  await withStore("readwrite", (s) => s.delete(HANDLE_KEY) as IDBRequest<undefined>);
}

/**
 * Can we read this handle without asking?
 *
 * `"granted"` means open it now; anything else means the interface must offer
 * a button, because `requestPermission` only works inside a user gesture.
 */
export async function handleReadable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await handle.queryPermission?.({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

/** Ask for read access. Must be called from a click or keypress. */
export async function requestHandleAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await handle.requestPermission?.({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}
