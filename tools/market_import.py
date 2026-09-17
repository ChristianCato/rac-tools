"""Market data import: what the advertising market and candidate interest were
doing each month, as a guide beside the remaining-error adjustment (D2).

It is a guide, not part of the model. Nothing here changes a plan's figures.
It sits on the Setup page only: never in the PDF, the workings export or the
Method text (addendum 2.5).

Two sources, both read from the data folder and written out as monthly
averages. No campaign names, no cell-level figures, nothing that identifies a
candidate:

  Google and Meta CPC and CPM   whether it got dearer or cheaper to reach
                                people, as an index: each month against that
                                platform's average over the whole period, so
                                100 is an average month. The repository is
                                public, so RAC's own prices are not written
                                into it. Meta's link clicks are used, which
                                are what compare with Google's clicks.
  Google Trends                 how many people were searching for these jobs

The Indeed Hiring Lab series is deliberately not here. Its access terms have
not been checked yet, so no figure from it is written into the repository. When
they have been, add it the same way. Whatever happens, no Hiring Lab figure may
appear in anything RAC sees; the output checks refuse to save a document that
even names it.

Usage (from the repo folder):
    python tools/market_import.py "PATH/TO/Google & Meta Ads CPM & CPC Data.xlsx" "PATH/TO/Google Trends Data.xlsx"
    python tools/market_import.py ... --check     confirms data/market.json matches, writes nothing

Neither workbook is ever committed; only the monthly averages below.
"""
import argparse, collections, datetime, json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'data', 'market.json')
# The campaigns the planner itself plans. Everything else in the export (the
# remarketing campaign, tests, other projects) is left out of the averages, so
# the guide describes the market the plan actually buys in.
PLATFORMS = {'google_ads': 'google', 'meta_ads': 'meta', 'facebook_ads': 'meta', 'facebook': 'meta', 'meta': 'meta'}


def month_of(value):
    s = str(value).strip()
    if '|' in s:
        y, m = s.split('|')[:2]
        return f'{int(y):04d}-{int(m):02d}'
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.strftime('%Y-%m')
    return s[:7]


def read_ads(path):
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb[wb.sheetnames[0]]
        rows = ws.iter_rows(values_only=True)
        header = [str(h or '').strip() for h in next(rows)]
        need = ['year_month', 'datasource', 'campaign', 'impressions', 'clicks', 'link_clicks', 'spend']
        missing = [n for n in need if n not in header]
        if missing:
            raise SystemExit(f'STOPPED: the CPC and CPM file is missing these columns: {", ".join(missing)}')
        ix = {n: header.index(n) for n in need}
        totals = collections.defaultdict(lambda: {'impressions': 0.0, 'clicks': 0.0, 'spend': 0.0, 'campaigns': set()})
        skipped = collections.Counter()
        for r in rows:
            if r is None or all(v is None for v in r):
                continue
            source = str(r[ix['datasource']] or '').strip().lower()
            plat = PLATFORMS.get(source)
            if not plat:
                skipped[source] += 1
                continue
            camp = str(r[ix['campaign']] or '')
            if 'remarketing' in camp.lower():
                skipped['remarketing'] += 1   # Combined Activity, not planned spend
                continue
            key = (month_of(r[ix['year_month']]), plat)
            t = totals[key]
            t['impressions'] += float(r[ix['impressions']] or 0)
            # Meta counts every click, including ones that never reach the
            # advert's page. Its link clicks are what compares with Google's.
            link = float(r[ix['link_clicks']] or 0)
            t['clicks'] += link if link > 0 else float(r[ix['clicks']] or 0)
            t['spend'] += float(r[ix['spend']] or 0)
            t['campaigns'].add(camp)
        return totals, skipped
    finally:
        wb.close()


def read_trends(path):
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb[wb.sheetnames[0]]
        rows = [r for r in ws.iter_rows(values_only=True)]
        head = None
        for i, r in enumerate(rows):
            if r and str(r[0] or '').strip().lower() == 'time':
                head = i
                break
        if head is None:
            raise SystemExit('STOPPED: the Google Trends file has no "Time" header row')
        terms = [str(h or '').strip() for h in rows[head][1:] if h]
        out = {}
        for r in rows[head + 1:]:
            if not r or r[0] is None:
                continue
            mo = month_of(r[0])
            out[mo] = {terms[i]: (None if r[i + 1] is None else float(r[i + 1])) for i in range(len(terms))}
        return terms, out
    finally:
        wb.close()


def build(ads_path, trends_path):
    totals, skipped = read_ads(ads_path)
    terms, trends = read_trends(trends_path)
    months = sorted({m for m, _ in totals} | set(trends))
    # What ships is the shape of the market, not RAC's own prices: each month
    # as a percentage of that platform's average over the whole period. The
    # repository is public, so no cost figure of RAC's is written into it.
    # 100 means the average month; 120 means a fifth dearer than usual.
    raw = {}
    for (mo, plat), t in totals.items():
        raw[(mo, plat)] = {
            'cpc': t['spend'] / t['clicks'] if t['clicks'] else None,
            'cpm': t['spend'] / t['impressions'] * 1000 if t['impressions'] else None,
            'campaigns': len(t['campaigns']),
        }
    mean = {}
    for plat in ('google', 'meta'):
        for what in ('cpc', 'cpm'):
            xs = [v[what] for (m, p), v in raw.items() if p == plat and v[what]]
            mean[(plat, what)] = sum(xs) / len(xs) if xs else None
    rows = []
    for mo in months:
        row = {'month': mo}
        for plat in ('google', 'meta'):
            v = raw.get((mo, plat))
            if not v:
                continue
            row[plat] = {
                'cpc_index': round(v['cpc'] / mean[(plat, 'cpc')] * 100, 1) if v['cpc'] and mean[(plat, 'cpc')] else None,
                'cpm_index': round(v['cpm'] / mean[(plat, 'cpm')] * 100, 1) if v['cpm'] and mean[(plat, 'cpm')] else None,
                'campaigns': v['campaigns'],
            }
        if mo in trends:
            row['searches'] = {k: v for k, v in trends[mo].items()}
        rows.append(row)
    return {
        'note': "A guide beside the remaining-error adjustment, not part of the model. Cost per click and per "
                "thousand impressions are given as an index: each month as a percentage of that platform's average "
                "over the whole period, so 100 is an average month. The repository is public, so no cost figure of "
                "RAC's is written into it. Google Trends search interest is as Google publishes it. Written by "
                "tools/market_import.py. The Indeed Hiring Lab series is deliberately not here: its access terms have "
                "not been checked.",
        'sources': {
            'ads': {'file': os.path.basename(ads_path), 'file_date': datetime.datetime.fromtimestamp(os.path.getmtime(ads_path)).date().isoformat()},
            'trends': {'file': os.path.basename(trends_path), 'file_date': datetime.datetime.fromtimestamp(os.path.getmtime(trends_path)).date().isoformat(), 'terms': terms},
        },
        'left_out': dict(skipped),
        'months': rows,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('ads')
    ap.add_argument('trends')
    ap.add_argument('--check', action='store_true', help='confirm data/market.json matches these files; write nothing')
    args = ap.parse_args(argv)
    out = build(args.ads, args.trends)
    text = json.dumps(out, indent=1) + '\n'
    print(f'{len(out["months"])} months, {out["sources"]["ads"]["file"]} and {out["sources"]["trends"]["file"]}; '
          f'left out: {out["left_out"] or "nothing"}.')
    if args.check:
        held = open(OUT, encoding='utf-8').read() if os.path.isfile(OUT) else ''
        same = held == text
        print('CHECK: data/market.json matches the source files' if same
              else 'CHECK FAILED: data/market.json does not match; re-run without --check')
        return 0 if same else 1
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print(f'Wrote {OUT}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
