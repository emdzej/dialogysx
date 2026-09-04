/**
 * A zip reader that works in a browser, over a `Blob`.
 *
 * The CLI uses `yauzl`, which needs `node:fs`. This exists because the same
 * archives have to be read in a tab, and two constraints rule out the obvious
 * approaches:
 *
 * **1. The local file headers are wrong.** Every entry in the Dialogys
 * archives carries `CRC-32 = 0` in its *local* header while the central
 * directory holds the true value. `unzip` fails these files outright; `yauzl`
 * passes because it reads the central directory. So must this — and it reads
 * sizes from there too, since a local header claiming zero-length data would
 * otherwise truncate every entry.
 *
 * **2. The archives are too big to hold in memory.** `fflate.unzip` does read
 * the central directory correctly, but wants the whole archive as one
 * `Uint8Array`; `images_1.zip` is 945 MB. This reads the end-of-central-
 * directory and the central directory through `Blob.slice()` — the same
 * addressing `IndexedRAF` already uses on the catalogue — and then streams one
 * entry at a time.
 *
 * Decompression is the platform's: `DecompressionStream("deflate-raw")`. No
 * library at all, because measured across the whole English 4.55 set every
 * entry is method 0 (stored) or 8 (deflate), and none uses zip64.
 */

/** Signatures, little-endian. */
const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;

/** How far back to look for the end-of-central-directory record. */
const EOCD_MAX = 22 + 0xffff;

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. Anything else is rejected on read. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** CRC-32 from the **central** directory, which is the one that is right. */
  crc32: number;
  /** Offset of the entry's local header. */
  localOffset: number;
  /** Directory entries carry no data and end in "/". */
  isDirectory: boolean;
}

/** The slice of a file this reader needs; `Blob` and `File` both satisfy it. */
export interface ByteSource {
  readonly size: number;
  slice(start: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer>; stream(): unknown };
}

function view(buf: ArrayBuffer): DataView {
  return new DataView(buf);
}

/**
 * Find the end-of-central-directory record.
 *
 * Scanned backwards from the end because the record is followed by a variable
 * comment. Bounded to 64 KB + 22: a longer scan would be reading file data and
 * could match the signature by chance.
 */
async function findEocd(src: ByteSource): Promise<{ buf: ArrayBuffer; offset: number }> {
  const len = Math.min(EOCD_MAX, src.size);
  const start = src.size - len;
  const buf = await src.slice(start, src.size).arrayBuffer();
  const dv = view(buf);
  for (let i = buf.byteLength - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD) return { buf, offset: start + i };
  }
  throw new Error("not a zip archive: no end-of-central-directory record");
}

/** Read the central directory. */
export async function readZipEntries(src: ByteSource): Promise<ZipEntry[]> {
  const { buf, offset } = await findEocd(src);
  const dv = view(buf);
  const rel = offset - (src.size - buf.byteLength);

  let count = dv.getUint16(rel + 10, true);
  let cdOffset = dv.getUint32(rel + 16, true);
  let cdSize = dv.getUint32(rel + 12, true);

  // Zip64, if present. None of the Dialogys archives use it, but a 0xffffffff
  // field silently read as a real offset would seek to nowhere, and the check
  // is four comparisons.
  if (rel >= 20 && dv.getUint32(rel - 20, true) === EOCD64_LOCATOR) {
    const zip64End = Number(dv.getBigUint64(rel - 12, true));
    const z = view(await src.slice(zip64End, zip64End + 56).arrayBuffer());
    if (z.getUint32(0, true) === EOCD64) {
      count = Number(z.getBigUint64(32, true));
      cdSize = Number(z.getBigUint64(40, true));
      cdOffset = Number(z.getBigUint64(48, true));
    }
  }

  const cd = view(await src.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength) break;
    if (cd.getUint32(p, true) !== CENTRAL) {
      throw new Error(`central directory entry ${i} has a bad signature`);
    }
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const name = decodeName(cd, p + 46, nameLen, cd.getUint16(p + 8, true));
    entries.push({
      name,
      method: cd.getUint16(p + 10, true),
      crc32: cd.getUint32(p + 16, true),
      compressedSize: cd.getUint32(p + 20, true),
      uncompressedSize: cd.getUint32(p + 24, true),
      localOffset: cd.getUint32(p + 42, true),
      isDirectory: name.endsWith("/"),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Entry names: UTF-8 when the language-encoding flag is set, cp437 otherwise.
 *
 * The Dialogys archives are ASCII throughout, so this rarely matters — but
 * decoding cp437 as UTF-8 turns a stray high byte into U+FFFD, and the file
 * would then be written under a name nothing can find.
 */
function decodeName(dv: DataView, at: number, len: number, flags: number): string {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + at, len);
  if ((flags & 0x800) !== 0) return new TextDecoder("utf-8").decode(bytes);
  // cp437's low half is ASCII; the high half only appears in archives from
  // DOS-era tools, and `TextDecoder` has no cp437, so map what matters.
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return out;
}

const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/**
 * Where an entry's data starts.
 *
 * The local header's length is variable, so its name and extra fields have to
 * be read to skip past it. Only those two lengths are trusted from the local
 * header — the sizes and CRC there are the ones that are zero.
 */
async function dataStart(src: ByteSource, entry: ZipEntry): Promise<number> {
  const head = view(await src.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  const nameLen = head.getUint16(26, true);
  const extraLen = head.getUint16(28, true);
  return entry.localOffset + 30 + nameLen + extraLen;
}

/**
 * A stream of one entry's uncompressed bytes.
 *
 * Streamed rather than buffered so a 52 MB entry inside a 945 MB archive costs
 * one entry's worth of memory, not the archive's.
 */
export async function openZipEntry(
  src: ByteSource,
  entry: ZipEntry,
): Promise<ReadableStream<Uint8Array>> {
  if (entry.isDirectory) throw new Error(`${entry.name}: a directory has no data`);
  const start = await dataStart(src, entry);
  const raw = src.slice(start, start + entry.compressedSize).stream() as ReadableStream<Uint8Array>;
  if (entry.method === 0) return raw;
  if (entry.method === 8) return raw.pipeThrough(new DecompressionStream("deflate-raw"));
  // Better to name the method than to hand back plausible-looking garbage.
  throw new Error(
    `${entry.name}: compression method ${entry.method} is not supported ` +
      `(only 0 stored and 8 deflate appear in Dialogys archives)`,
  );
}

/** One entry's bytes, for the small files. */
export async function readZipEntry(src: ByteSource, entry: ZipEntry): Promise<Uint8Array> {
  const stream = await openZipEntry(src, entry);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * CRC-32, so an extracted entry can be checked against the central directory.
 *
 * Worth having precisely because these archives put zero in their local
 * headers: the only correctness check available is the central value, and
 * without it "the right number of bytes" is the strongest thing that could be
 * said about an extraction.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/**
 * A `ByteSource` over HTTP, so an archive can be read without downloading it.
 *
 * `Blob` and `File` satisfy `ByteSource` already; this is the missing third
 * backend. Each `slice` is one `Range` request, and `stream()` hands back the
 * response body rather than buffering it — so a 52 MB entry inside a 945 MB
 * archive costs one entry's worth of memory.
 *
 * Requires the host to honour `Range`, and says so loudly rather than reading
 * the wrong bytes, exactly as `HttpRangeReader` does.
 */
export function httpByteSource(
  url: string,
  size: number,
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
): ByteSource {
  return {
    size,
    slice(start: number, end?: number) {
      const last = (end ?? size) - 1;
      const request = async (): Promise<Response> => {
        if (last < start) {
          // An empty range is not a valid `Range` header, and asking for one
          // would get the whole file back.
          return new Response(new Uint8Array(0));
        }
        const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${last}` } });
        if (res.status !== 206) {
          throw new Error(
            `GET ${url} Range bytes=${start}-${last}: expected 206, got ${res.status}` +
              ` — the host is ignoring Range requests`,
          );
        }
        return res;
      };
      return {
        async arrayBuffer(): Promise<ArrayBuffer> {
          return await (await request()).arrayBuffer();
        },
        stream(): unknown {
          // Deferred: the request is issued when the stream is first pulled,
          // so a caller that never reads it costs nothing.
          let inner: ReadableStreamDefaultReader<Uint8Array> | undefined;
          return new ReadableStream<Uint8Array>({
            async pull(controller) {
              inner ??= ((await request()).body ?? new ReadableStream()).getReader();
              const { done, value } = await inner.read();
              if (done) controller.close();
              else controller.enqueue(value);
            },
          });
        },
      };
    },
  };
}
