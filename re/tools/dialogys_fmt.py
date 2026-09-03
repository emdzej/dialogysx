#!/usr/bin/env python3
"""
Dialogys indexed-file reader.

Reverse-engineered from dialogys.indexingfiles.* in dialogysapplet.jar.

Two container shapes:

  SortedCobolFile(path, recordLength, keyLength)
      Flat array of fixed-length records, sorted ascending by the leading
      `keyLength` bytes, located by binary search (renault.misc.RenaultDichotomie).

  IndexedRAF  -- "level-1 index" over a variable-length data file:
      index1: SortedCobolFile with recordLength = keyLength + 12
              record = key[keyLength] || position:int64be || longueur:int32be
      Two flavours of what `position` points at:
        2-level (newRAFIndexedByCobol):        index1 -> data
        3-level (newRAFIndexedByRAFIndexedByCobol):
                                               index1 -> index2 -> data
              index2 record = count:int32be || pad:int32be
                              || count x (position:int64be, longueur:int32be)
              (MultipleRAFRecordInfoFactory reads count then skips to +8;
               RAFIndex_IndexedFile uses DataInputStream so reads count:int32
               then entries directly -- the pad only exists in the former path.)
"""
from __future__ import annotations
import struct, os, bisect

ENC = 'cp1252'


def _cmp(a: bytes, b: bytes) -> int:
    """Clef.compareByteArrays -- SIGNED byte comparison, Java semantics."""
    for x, y in zip(a, b):
        if x != y:
            return (x - 256 if x > 127 else x) - (y - 256 if y > 127 else y)
    return len(a) - len(b)


class SortedCobolFile:
    """Fixed-length sorted records, binary-searched on the leading key."""

    def __init__(self, path, record_length, key_length):
        self.path = path
        self.record_length = record_length
        self.key_length = key_length
        self.size_bytes = os.path.getsize(path)
        if self.size_bytes % record_length:
            raise ValueError(
                f"{path}: {self.size_bytes} bytes is not a multiple of "
                f"record length {record_length} "
                f"(remainder {self.size_bytes % record_length})")
        self.count = self.size_bytes // record_length
        self._f = open(path, 'rb')

    def record(self, i: int) -> bytes:
        self._f.seek(i * self.record_length)
        return self._f.read(self.record_length)

    def key(self, i: int) -> bytes:
        self._f.seek(i * self.record_length)
        return self._f.read(self.key_length)

    def search(self, key: bytes) -> int:
        """Exact match -> index, else -(insertion_point)-1, as Java's dichotomie."""
        lo, hi = 0, self.count - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            c = _cmp(key, self.key(mid))
            if c > 0:
                lo = mid + 1
            elif c < 0:
                hi = mid - 1
            else:
                return mid
        return -(lo + 1)

    def find_prefix(self, prefix: bytes):
        """All record indices whose key starts with `prefix`."""
        i = self.search(prefix)
        start = i if i >= 0 else -1 - i
        # walk back over equal-prefix records
        while start > 0 and self.key(start - 1).startswith(prefix):
            start -= 1
        out = []
        j = start
        while j < self.count and self.key(j).startswith(prefix):
            out.append(j)
            j += 1
        return out

    def __iter__(self):
        self._f.seek(0)
        for _ in range(self.count):
            yield self._f.read(self.record_length)


class IndexedRAF:
    """Variable-length data file addressed through a 2- or 3-level index."""

    def __init__(self, data_path, index_stem, key_length, levels=3):
        self.key_length = key_length
        self.levels = levels
        i1 = index_stem + '1' if levels == 3 else index_stem
        self.index1 = SortedCobolFile(i1, key_length + 12, key_length)
        self._i2 = open(index_stem + '2', 'rb') if levels == 3 else None
        self._data = open(data_path, 'rb')
        self.data_len = os.path.getsize(data_path)

    @staticmethod
    def _ptr(rec, key_length):
        pos, ln = struct.unpack_from('>qi', rec, key_length)
        return pos, ln

    def _read_index2(self, pos, ln):
        self._i2.seek(pos)
        blob = self._i2.read(ln)
        (count,) = struct.unpack_from('>i', blob, 0)
        out = []
        off = 4
        for _ in range(count):
            p, l = struct.unpack_from('>qi', blob, off)
            out.append((p, l))
            off += 12
        return out, blob

    def pointers_at(self, i: int):
        """Data (position, longueur) pairs for level-1 record i."""
        rec = self.index1.record(i)
        pos, ln = self._ptr(rec, self.key_length)
        if self.levels == 2:
            return [(pos, ln)]
        ptrs, _ = self._read_index2(pos, ln)
        return ptrs

    def key_at(self, i: int) -> bytes:
        return self.index1.key(i)

    def read(self, pos, ln) -> bytes:
        self._data.seek(pos)
        return self._data.read(ln)

    def records_at(self, i: int):
        return [self.read(p, l) for p, l in self.pointers_at(i)]

    def get(self, key):
        if isinstance(key, str):
            key = key.encode(ENC)
        i = self.index1.search(key)
        if i < 0:
            raise KeyError(key)
        return self.records_at(i)

    def get_prefix(self, key):
        if isinstance(key, str):
            key = key.encode(ENC)
        out = []
        for i in self.index1.find_prefix(key):
            out.extend(self.records_at(i))
        return out


# --------------------------------------------------------------------------
# Dataset registry -- keyLength and depth for each shipped dataset.
# `key source` for each is recorded in docs/data-format.md section 3.
# Paths are relative to a mounted disc's `dialogys/data` directory.
# --------------------------------------------------------------------------
DATASETS = [
    # name,                data file,               index stem,                  key, levels
    ("Planches",           "pr/Planches.dat",       "pr/Planches.idx",            11, 2),
    ("Organes",            "pr/Organes.dat",        "pr/Organes.idx",              9, 2),
    ("refNumPr",           "pr/refNumPr.dat",       "pr/refNumPr.idx",            10, 2),
    ("enveloppe PR>TYPE",  "enveloppe/enveloppe",   "enveloppe/prtype",            8, 3),
    ("enveloppe TYPE>PR",  "enveloppe/enveloppe",   "enveloppe/typepr",            8, 3),
    ("enveloppe MOTEUR",   "enveloppe/enveloppe",   "enveloppe/moteur",            3, 3),
    ("enveloppe BOITE",    "enveloppe/enveloppe",   "enveloppe/boite",             3, 3),
    ("typesetpr",          "enveloppe/typesetpr",   "enveloppe/typesetprindex",    8, 3),
    ("Dates",              "Dates/Dates",           "Dates/datesindex",            8, 3),
    ("prremp",             "PR1100/prremp",         "PR1100/prrempindex",         10, 3),
    ("TRepere",            "dessins/TRepere.dat",   "dessins/TRepere.idx",        13, 2),
]

# Language-scoped datasets: <root>/langue/<lg>/...
LANG_DATASETS = [
    ("papv",               "papv/papv",             "papv/papvindex",             22, 2),
]


def validate(root, verbose=False):
    """Re-run the checks documented in docs/data-format.md section 6.

    1. index file size divides exactly by keyLength + 12
    2. keys non-decreasing under SIGNED byte comparison
    3. every data pointer lies inside the data file

    Returns the number of failures.
    """
    import glob
    jobs = [(n, d, s, k, l) for (n, d, s, k, l) in DATASETS]
    for lg in sorted(glob.glob(os.path.join(root, 'langue', '*'))):
        if not os.path.isdir(lg):
            continue
        tag = os.path.basename(lg)
        for (n, d, s, k, l) in LANG_DATASETS:
            jobs.append((f"{n} [{tag}]",
                         os.path.join('langue', tag, d),
                         os.path.join('langue', tag, s), k, l))

    failures = 0
    checked = 0
    for name, data, stem, kl, levels in jobs:
        dp, sp = os.path.join(root, data), os.path.join(root, stem)
        probe = sp + '1' if levels == 3 else sp
        if not (os.path.exists(dp) and os.path.exists(probe)):
            print(f"  --  {name:24s} absent")
            continue
        checked += 1
        try:
            r = IndexedRAF(dp, sp, kl, levels)
        except ValueError as e:      # check 1
            print(f"  FAIL {name:24s} {e}")
            failures += 1
            continue

        unsorted_ = oob = 0
        prev = None
        for i in range(r.index1.count):
            k = r.index1.key(i)
            if prev is not None and _cmp(prev, k) > 0:
                unsorted_ += 1
            prev = k
            for p, l in r.pointers_at(i):
                if p < 0 or p + l > r.data_len:
                    oob += 1
        ok = unsorted_ == 0 and oob == 0
        failures += 0 if ok else 1
        print(f"  {'ok  ' if ok else 'FAIL'} {name:24s} "
              f"key={kl} depth={levels} keys={r.index1.count:>7d} "
              f"unsorted={unsorted_} bad_ptrs={oob}")
        if verbose and r.index1.count:
            rec = r.records_at(0)[0]
            print(f"       {r.index1.key(0)!r} -> {rec[:100].decode(ENC, 'replace')!r}")

    print(f"\n{checked} dataset(s) checked, {failures} failed")
    return failures


if __name__ == '__main__':
    import sys
    if len(sys.argv) >= 3 and sys.argv[1] == '--validate':
        sys.exit(1 if validate(sys.argv[2], '-v' in sys.argv) else 0)
    print(__doc__)
    print("usage: dialogys_fmt.py --validate <mounted-dvd>/dialogys/data [-v]")
