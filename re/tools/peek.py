#!/usr/bin/env python3
"""Dump a Dialogys data file: CR-separated records, TAB-separated fields, cp1252."""
import sys, zipfile, io, os

def show(name, data, nrec=30, enc='cp1252'):
    print(f"===== {name}  ({len(data)} bytes) =====")
    # detect record separator
    cr, lf = data.count(b'\r'), data.count(b'\n')
    print(f"  [sep] CR={cr} LF={lf} TAB={data.count(9)} NUL={data.count(0)}")
    txt = data.decode(enc, errors='replace')
    recs = txt.replace('\r\n', '\r').replace('\n', '\r').split('\r')
    for i, r in enumerate(recs[:nrec]):
        print(f"  {i:4d}| " + r.replace('\t', ' | '))
    if len(recs) > nrec:
        print(f"  ... {len(recs)-nrec} more records")

def main():
    p = sys.argv[1]
    nrec = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    if zipfile.is_zipfile(p):
        z = zipfile.ZipFile(p)
        print(f"### ZIP {p}: {z.namelist()}")
        for n in z.namelist():
            show(n, z.read(n), nrec)
    else:
        show(p, open(p, 'rb').read(), nrec)

main()
