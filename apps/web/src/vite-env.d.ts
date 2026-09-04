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
