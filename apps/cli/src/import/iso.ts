/**
 * Mount ISO images so the importer can read them as directories.
 *
 * Only macOS is implemented, because `hdiutil` is what is available here and
 * guessing at `mount -o loop` (Linux, needs root) or `PowerShell
 * Mount-DiskImage` (Windows) untested would be worse than saying so. On other
 * platforms the CLI asks for already-mounted directories, which it accepts
 * everywhere.
 */
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Mounted {
  path: string;
  /** Set when we mounted it and should detach it afterwards. */
  detach?: () => Promise<void>;
}

export function canMountIso(): boolean {
  return platform() === "darwin";
}

/**
 * Attach an ISO read-only and return its mount point.
 *
 * `-nobrowse` keeps it out of Finder; `-readonly` is not politeness but
 * protection — these are the only copies of the data.
 */
export async function mountIso(isoPath: string): Promise<Mounted> {
  if (!canMountIso()) {
    throw new Error(
      `Mounting ISO images is only implemented on macOS. Mount ${isoPath} yourself ` +
        `and pass the mount point instead.`,
    );
  }
  const attach = (extra: string[]) =>
    run("hdiutil", ["attach", "-readonly", "-nobrowse", ...extra, isoPath]);
  let stdout: string;
  try {
    ({ stdout } = await attach([]));
  } catch (e) {
    // "image not recognised" does not always mean a broken image. Two of the
    // five 4.55 discs end one byte short of a 2048-byte sector boundary — the
    // signature of an interrupted transfer — and `hdiutil` refuses a file whose
    // length is not a whole number of sectors, even though the ISO 9660
    // descriptors and every file extent read back clean. Naming the image class
    // explicitly skips that check.
    if (!/not recognised|not recognized/i.test(e instanceof Error ? e.message : String(e))) throw e;
    ({ stdout } = await attach(["-imagekey", "diskimage-class=CRawDiskImage"]));
  }
  // Output is TAB-separated columns; the mount point is the last one on the
  // line that has it. Take the last non-empty match so a multi-partition image
  // resolves to its mounted volume rather than a bare /dev entry.
  const mountPoints = stdout
    .split("\n")
    .map((line) => line.split("\t").pop()?.trim() ?? "")
    .filter((p) => p.startsWith("/Volumes/"));
  const path = mountPoints.at(-1);
  if (path === undefined) {
    throw new Error(`hdiutil attached ${isoPath} but reported no mount point:\n${stdout}`);
  }
  return {
    path,
    detach: async () => {
      await run("hdiutil", ["detach", path]).catch(() => {
        // A detach failure is not worth failing the import over — the data is
        // already copied. Say nothing here; the caller reports what it left.
      });
    },
  };
}
