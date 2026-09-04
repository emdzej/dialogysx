/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * File System Access API surface we use.
 *
 * `showDirectoryPicker` and `FileSystemDirectoryHandle.entries()` are not in
 * TypeScript's DOM lib yet, and the API is Chromium-only, so the declaration is
 * deliberately narrow: only what `LocalDirectorySource` touches, and typed as
 * possibly-`undefined` so callers have to check before using it.
 *
 * This file has no imports, so it is a global script and these declarations
 * land on `globalThis` directly — a `declare global` block here would be
 * wrong, not merely redundant.
 */
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
  /**
   * Permission state for a handle restored from IndexedDB.
   *
   * Optional because these are not in TypeScript's DOM lib either, and because
   * a handle from an older browser may not have them — the callers treat a
   * missing method as "not readable" rather than assuming access.
   */
  queryPermission?(opts?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(opts?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface FileSystemFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  /**
   * Staged write: a temporary file that replaces the target on `close()`.
   *
   * Not in TypeScript's DOM lib, and typed here as the narrow thing the
   * importer uses — a `WritableStream` it can `pipeTo`, plus `write`/`close`
   * for the small files.
   */
  createWritable(opts?: { keepExistingData?: boolean }): Promise<
    WritableStream<Uint8Array> & {
      write(data: BufferSource): Promise<void>;
      close(): Promise<void>;
    }
  >;
}

declare var showDirectoryPicker:
  undefined | ((opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>);

/**
 * Build-time literals from the root `package.json`, injected by `define` in
 * `vite.config.ts`. Declared here rather than imported so nothing reads the
 * manifest at runtime.
 */
declare const __APP_VERSION__: string;
declare const __REPO_URL__: string;
