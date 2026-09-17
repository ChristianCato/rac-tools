"""Builds a test fixture from a workings export: every raw monthly row, and the
figures the plan produced for each location and platform.

Usage: python3 tests/tools/build_fixture_from_workings.py "Workings.xlsx" out.json [role]

The export's Workings and Summary sheets are live formulas. A file saved by
Excel carries their values; a file straight from the app may not. If values are
missing, recalculate a copy first (open and save in Excel, or LibreOffice
headless) and point this script at the copy. The script stops rather than
writing a fixture with gaps."""
import json, sys
from openpyxl import load_workbook
src, out = sys.argv[1], sys.argv[2]
role = sys.argv[3] if len(sys.argv) > 3 else 'SMR'
wb = load_workbook(src, read_only=True, data_only=True)
pmap = {'Indeed': 'indeed', 'Meta': 'meta', 'Google': 'google', 'Appcast': 'appcast'}
raw = []
for r in wb['Raw monthly data'].iter_rows(min_row=5, values_only=True):
    if not r[0]: continue
    raw.append([r[0], r[1], r[2], r[3] or 0, r[4] or 0, r[5] if isinstance(r[5], (int, float)) else None, r[8]])
cells = {}
for r in wb['Workings'].iter_rows(min_row=5, values_only=True):
    if r[1] not in pmap: continue
    vals = {'openRoles': r[2], 'cpa': r[8], 'spend': r[9], 'apps': r[10], 'biggestMonth': r[11], 'hireRate': r[13], 'hires': r[14]}
    missing = [k for k, v in vals.items() if not isinstance(v, (int, float))]
    if missing: sys.exit(f'{r[0]} {r[1]}: no value in {missing}. Recalculate the workbook first.')
    cells[f'{r[0]}|{pmap[r[1]]}'] = vals
summary = {r[0]: r[1] for r in wb['Summary'].iter_rows(min_row=5, values_only=True) if r and r[0]}
json.dump({'source': src.split('/')[-1], 'role': role, 'raw': raw, 'cells': cells, 'summary': summary},
          open(out, 'w'), indent=0, default=str)
print(f'{len(raw)} raw rows, {len(cells)} workings rows -> {out}')
