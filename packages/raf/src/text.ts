/**
 * Text conventions of the catalogue data. See `docs/data-format.md` §2.3.
 *
 * Three things bite here:
 *   - the encoding is cp1252, not UTF-8;
 *   - records are separated by CR alone, so splitting on `\n` yields one
 *     enormous line;
 *   - strings inside binary payloads are Java `writeUTF`, which is length-
 *     prefixed modified UTF-8, not NUL-terminated.
 */

/**
 * Decoding is the platform's job, not ours.
 *
 * `TextDecoder` is the WHATWG Encoding Standard implementation: built into
 * Node 18+ and every browser, `windows-1252` is a required label, and the
 * mapping is normative. `iconv-lite` would add a dependency and be Node-only
 * for a worse version of the same thing.
 */
const CP1252 = new TextDecoder("windows-1252");
const UTF8 = new TextDecoder("utf-8");

/**
 * **Encoding is per file, not global.** Measured over a disc:
 *
 * | File | Encoding |
 * | --- | --- |
 * | `classicvar.utf` | UTF-8 (8,190 high bytes, decodes cleanly) |
 * | `papv`, `ListeVarVal`, `ListeItemsAbsentsMenu` | cp1252 (invalid as UTF-8) |
 * | `typesvin`, `ListePROrganes`, `refContexte` | ASCII, so either works |
 *
 * The `.utf` suffix is the marker: those files are UTF-8, everything else is
 * cp1252. Getting it backwards is not a crash, it is mojibake — `classicvar`
 * read as cp1252 yields "Air conditionnÃ© normal", which looks like data.
 *
 * `decodeText` is the cp1252 default because that is most of the tree; call
 * `decodeUtf8` for `.utf` files.
 */
export function decodeText(bytes: Uint8Array): string {
  return CP1252.decode(bytes);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return UTF8.decode(bytes);
}

/** Pick a decoder from the filename, following the `.utf` convention. */
export function decodeForPath(path: string, bytes: Uint8Array): string {
  return path.endsWith(".utf") ? decodeUtf8(bytes) : decodeText(bytes);
}

/** Split a CR-separated file into records, tolerating CRLF and stray LF. */
export function splitRecords(text: string): string[] {
  return text.replace(/\r\n/g, "\r").replace(/\n/g, "\r").split("\r");
}

/** Split a record into its TAB-delimited fields. */
export function splitFields(record: string): string[] {
  return record.split("\t");
}

/**
 * Trim the NUL padding the original appends to short keys (`Clef(String, int)`)
 * and the trailing spaces used in fixed-width fields.
 */
export function trimPadding(s: string): string {
  return s.replace(/[\0 ]+$/, "");
}

/** Encode a key as cp1252 bytes, NUL-padded to `length` if given. */
export function encodeKey(key: string, length?: number): Uint8Array {
  const out = new Uint8Array(length ?? key.length);
  for (let i = 0; i < key.length && i < out.length; i++) {
    const c = key.charCodeAt(i);
    // Keys in the shipped data are ASCII throughout (0 of 583,035 have a byte
    // above 0x7F), so a straight charCode is exact for every real key. Anything
    // outside Latin-1 is a caller error, not something to guess at.
    if (c > 0xff) throw new Error(`key ${JSON.stringify(key)}: char ${i} is not representable`);
    out[i] = c;
  }
  return out;
}

/**
 * A cursor over a Java `DataOutput` stream — the shape of the binary payloads
 * in `Planches.dat`, `Organes.dat` and `refNumPr.dat`.
 */
export class DataCursor {
  offset = 0;
  private readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get atEnd(): boolean {
    return this.offset >= this.bytes.length;
  }

  u8(): number {
    return this.bytes[this.offset++]!;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset);
    this.offset += 2;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.offset);
    this.offset += 4;
    return v;
  }

  take(n: number): Uint8Array {
    const v = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  /** `DataInput.readUTF`: `length:uint16be` then that many bytes. */
  utf(): string {
    const len = this.u16();
    return decodeModifiedUtf8(this.take(len));
  }

  /** Peek the next `uint16` without advancing. */
  peekU16(): number {
    return this.view.getUint16(this.offset);
  }
}

/**
 * Java modified UTF-8. Differs from real UTF-8 in two ways: NUL is encoded as
 * the two bytes `C0 80`, and characters outside the BMP arrive as a surrogate
 * pair of three-byte sequences rather than one four-byte sequence.
 *
 * The catalogue's strings are part numbers and short codes, so in practice this
 * only ever sees ASCII — but decoding it as real UTF-8 would mis-handle the
 * `C0 80` case silently, and silence is what we are trying to avoid.
 */
export function decodeModifiedUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const a = bytes[i++]!;
    if (a < 0x80) {
      out += String.fromCharCode(a);
    } else if ((a & 0xe0) === 0xc0) {
      const b = bytes[i++]!;
      out += String.fromCharCode(((a & 0x1f) << 6) | (b & 0x3f));
    } else if ((a & 0xf0) === 0xe0) {
      const b = bytes[i++]!;
      const c = bytes[i++]!;
      out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
    } else {
      // Not valid modified UTF-8. Surface it rather than emit a silent U+FFFD.
      throw new Error(`invalid modified UTF-8 lead byte 0x${a.toString(16)} at ${i - 1}`);
    }
  }
  return out;
}
