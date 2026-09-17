"""Checks for tools/eploy_import.py on small made-up workbooks.

Run: python tests/tools/test_eploy_import.py   (run.mjs calls it)
Each case builds a workbook in a temporary folder, runs the import against a
temporary output file and checks it either works or stops with the right
message. Prints one line per case and exits 1 if any case fails.
"""
import datetime, importlib.util, json, os, sys, tempfile
from openpyxl import Workbook

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('eploy_import', os.path.join(HERE, '..', '..', 'tools', 'eploy_import.py'))
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)

HEADERS = ['Vacancy ID', 'Application Date', 'Candidate ID', 'Corrected Detail', 'Hired',
           'Progressed Past Screening', 'Patrol or SMR', 'Region', 'Title:']
D = datetime.datetime


def rows_default():
    return [
        ['V1', D(2026, 1, 5), 'CAND-SECRET-1', 'Paid Indeed', 'TRUE', 'TRUE', 'SMR', 'London', 'Tech'],
        ['V1', D(2026, 1, 6), 'CAND-SECRET-2', 'Paid Facebook ', 'FALSE', 'TRUE', 'SMR', 'London', 'Tech'],
        ['V2', D(2026, 2, 1), 'CAND-SECRET-3', 'Indeed (Organic or Paid)', 'FALSE', 'FALSE', 'Patrol', 'Yorkshire and The Humber', 'Tech'],
        ['V3', D(2026, 2, 2), 'CAND-SECRET-4', 'Organic Google Search', 'FALSE', 'FALSE', 'SMR', None, 'Tech'],
        ['V4', D(2026, 2, 3), 'CAND-SECRET-5', 'Some New Board', 'FALSE', 'FALSE', 'Other', 'Mars', 'Other job'],
    ]


def make(folder, name, headers=HEADERS, rows=None, order=None):
    wb = Workbook()
    ws = wb.active
    ws.title = imp.SHEET
    ws.append(['NOTES'])
    rows = rows_default() if rows is None else rows
    idx = list(range(len(headers))) if order is None else order
    ws.append([headers[i] for i in idx])
    for r in rows:
        ws.append([r[i] for i in idx])
    path = os.path.join(folder, name)
    wb.save(path)
    ts = D(2026, 9, 15).timestamp()
    os.utime(path, (ts, ts))
    return path


def run(path, accept=False):
    try:
        out, prev, report = imp.build(path, accept)
        return out, None
    except imp.ImportStopped as e:
        return None, str(e)


def main():
    fails = []
    with tempfile.TemporaryDirectory() as tmp:
        imp.OUT = os.path.join(tmp, 'eploy_rates.json')

        def case(name, ok, detail=''):
            print(('PASS ' if ok else 'FAIL ') + name + (': ' + detail if detail else ''))
            if not ok:
                fails.append(name)

        # 1. Columns in another order, extra columns: reads by name.
        order = [8, 7, 6, 5, 4, 3, 2, 1, 0]
        out, err = run(make(tmp, 'reordered.xlsx', order=order))
        cells = out and {tuple(c[:4]): c[4:] for c in out['cells']}
        ok = out is not None and cells == {
            ('SMR', 'London', 'indeed', '2026-01'): [1, 1, 1],
            ('SMR', 'London', 'meta', '2026-01'): [1, 1, 0],
            ('Patrol', 'Yorkshire & Humber', 'indeed', '2026-02'): [1, 0, 0],
            ('SMR', 'Unknown', 'other', '2026-02'): [1, 0, 0],
        }
        case('columns read by header name in any order', ok, err or str(cells))
        text = json.dumps(out)
        case('output holds no candidate-level fields', out is not None and 'CAND-SECRET' not in text and 'V1' not in text
             and all(len(c) == 7 for c in out['cells']) and out['dataset']['rows_other_roles'] == 1,
             'candidate or vacancy value found in output' if 'CAND-SECRET' in text else '')
        case('rows with no region counted and reported', out is not None and out['dataset']['unknown_region_applications'] == {'SMR': 1})

        # 2. Missing required column.
        h = [x if x != 'Hired' else 'Hired?' for x in HEADERS]
        out, err = run(make(tmp, 'missing.xlsx', headers=h))
        case('missing column stops the import', out is None and 'required columns not found in row 2: Hired' in (err or ''), err)

        # 3. Unmapped labels are listed.
        rows = rows_default()
        rows[0][3] = 'Paid Snapchat'
        rows[1][7] = 'Atlantis'
        out, err = run(make(tmp, 'unmapped.xlsx', rows=rows))
        case('unmapped labels stop the import and are listed', out is None and 'source: "Paid Snapchat" (1 rows)' in (err or '')
             and 'region: "Atlantis" (1 rows)' in (err or ''), err)

        # 4. Unexpected Hired value.
        rows = rows_default()
        rows[0][4] = 'Yes'
        out, err = run(make(tmp, 'badflag.xlsx', rows=rows))
        case('unexpected Hired value stops the import', out is None and "Hired: 'Yes' (1 rows)" in (err or ''), err)

        # 5. Empty formula column.
        rows = rows_default()
        for r in rows:
            r[5] = None
        out, err = run(make(tmp, 'empty.xlsx', rows=rows))
        case('empty formula column stops the import with the Excel hint', out is None and 'Progressed Past Screening: empty' in (err or '')
             and 'open the workbook in Excel' in (err or ''), err)

        # 6. Date out of range.
        rows = rows_default()
        rows[0][1] = D(2025, 6, 1)
        out, err = run(make(tmp, 'early.xlsx', rows=rows))
        case('date before eploy_first_month stops the import', out is None and 'outside 2025-10-01 to 2026-09-15 (1 rows)' in (err or ''), err)
        rows = rows_default()
        rows[0][1] = D(2026, 10, 1)
        out, err = run(make(tmp, 'late.xlsx', rows=rows))
        case('date after the file date stops the import', out is None and 'outside 2025-10-01 to 2026-09-15' in (err or ''), err)

        # 7. Comparison with the previous import.
        base_rows = rows_default() + [['V9', D(2026, 1, 9), 'C', 'Paid Indeed', 'FALSE', 'FALSE', 'SMR', 'London', 'T']] * 30
        out, err = run(make(tmp, 'prev.xlsx', rows=base_rows))
        with open(imp.OUT, 'w', encoding='utf-8') as f:
            json.dump(out, f)
        more = base_rows + [['V9', D(2026, 1, 10), 'C', 'Paid Indeed', 'FALSE', 'FALSE', 'SMR', 'London', 'T']] * 5
        out2, err2 = run(make(tmp, 'shifted.xlsx', rows=more))
        case('shift above 10% on a shared month stops the import', out2 is None and 'SMR indeed applications: 31 to 36' in (err2 or ''), err2)
        out3, err3 = run(make(tmp, 'shifted.xlsx', rows=more), accept=True)
        case('--accept-changes lets a reviewed shift through', out3 is not None, err3)
        added = base_rows + [['V9', D(2026, 3, 10), 'C', 'Paid Indeed', 'FALSE', 'FALSE', 'SMR', 'London', 'T']] * 20
        out4, err4 = run(make(tmp, 'added.xlsx', rows=added))
        case('a new month alone does not count as a shift', out4 is not None, err4)

    print(f'{len(fails)} failed' if fails else 'all eploy import checks passed')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
