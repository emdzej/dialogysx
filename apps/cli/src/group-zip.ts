/**
 * Read a PR group's `<group>.zip`, which carries its `ListeVarVal` value table.
 *
 * Goes through `yauzl` because it reads the **central directory**, where these
 * archives keep their correct CRCs — the local file headers all say zero. See
 * `docs/data-format.md` §3.8.
 */
import { GroupValues, type FileSource } from "@dialogysx/catalogue";
import yauzl from "yauzl";

const cache = new Map<string, GroupValues | undefined>();

function entryFromBuffer(buf: Buffer, name: string): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip open failed"));
      zip.on("error", reject);
      zip.on("end", () => resolve(undefined));
      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName !== name) return void zip.readEntry();
        zip.openReadStream(entry, (e2, rs) => {
          if (e2 || !rs) return reject(e2 ?? new Error("no stream"));
          const chunks: Buffer[] = [];
          rs.on("data", (d: Buffer) => chunks.push(d));
          rs.on("error", reject);
          rs.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * A group's value table, or `undefined` when the group has no `ListeVarVal`.
 *
 * Absence is normal — group `0000` ships `ListeDoc` instead — so callers get
 * `undefined` rather than an exception, and conditions over that group's
 * variables then evaluate to unknown rather than to a wrong answer.
 */
export async function readGroupZip(
  source: FileSource,
  group: string,
): Promise<GroupValues | undefined> {
  if (cache.has(group)) return cache.get(group);
  const bytes = await source.readAll(`pr/${group}.zip`);
  let result: GroupValues | undefined;
  if (bytes) {
    const entry = await entryFromBuffer(Buffer.from(bytes), "ListeVarVal");
    if (entry) result = GroupValues.parse(entry);
  }
  cache.set(group, result);
  return result;
}
