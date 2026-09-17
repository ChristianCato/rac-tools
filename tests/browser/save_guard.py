"""Browser check: the live address saves, a test link does not.

Opens index.html in headless Chromium twice, once as rac-tools.vercel.app and
once as a Vercel test link address, with the database replaced by a stand-in
that records every request. Signs in with a stand-in session, changes a
setting, and waits for the save.

Pass: the live address sends database writes and shows no banner; the test
link sends none, shows the test version banner and shows Not saved.

Network guard (tests/browser/guard.py): every request is either handled
explicitly or blocked, and any blocked request fails the check. Before the
save test, each page fires probe requests (an unknown host and the app's own
/api address) and the check fails unless both were blocked.

Needs Python 3 with playwright (pip install playwright; playwright install chromium).
Run from the repo folder:  python tests/browser/save_guard.py
If the machine cannot reach unpkg and cdnjs, pass a folder holding npm installs
of react@18.3.1, react-dom@18.3.1, @babel/standalone@7.25.6, jspdf@2.5.1,
xlsx@0.18.5 and exceljs@4.4.0:  python tests/browser/save_guard.py --libs DIR
Screenshots are written to tests/browser/out/."""
import os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from guard import LIVE, TEST, new_page, libs_arg

OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
LIBS = libs_arg(sys.argv)


def run(browser, url):
    ctx, page, guard, errors = new_page(browser, url, libs=LIBS)
    page.goto(url)
    page.wait_for_selector('.app-header', timeout=60000)
    page.wait_for_timeout(1500)
    probe_ok = guard.probe(page)
    # Change a setting: the first editable number box on the Setup tab.
    box = page.locator('input.text-input').first
    box.click(); box.press('End'); box.type('1'); box.press('Tab')
    page.wait_for_timeout(2500)   # saves go 800ms after a change
    banner = page.locator('.test-banner').count()
    sync = page.locator('.sync').first.inner_text()
    page.screenshot(path=os.path.join(OUT, ('live' if url == LIVE else 'test_link') + '.png'))
    ctx.close()
    return {'writes': guard.writes, 'reads': len(guard.reads), 'banner': banner, 'sync': sync, 'errors': errors,
            'blocked': guard.blocked, 'probe': probe_ok}


with sync_playwright() as p:
    b = p.chromium.launch()
    live, test = run(b, LIVE), run(b, TEST)
    b.close()

fails = []
if not live['writes']: fails.append('live address sent no database writes')
if live['banner']: fails.append('live address shows the test banner')
if test['writes']: fails.append('test link sent database writes: %s' % test['writes'])
if not test['banner']: fails.append('test link shows no banner')
if test['sync'].strip() != 'Not saved': fails.append('test link save label reads %r' % test['sync'])
for name, r in (('live', live), ('test link', test)):
    print(f"{name}: guard probe {'blocked' if r['probe'] else 'NOT BLOCKED'}, {len(r['blocked'])} other blocked, {len(r['writes'])} writes {sorted(set(w[2][:25] for w in r['writes']))}, {r['reads']} reads, banner {bool(r['banner'])}, label {r['sync']!r}, page errors {len(r['errors'])}")
    if r['errors']: fails.append(f"{name} page errors: {r['errors'][:2]}")
    if not r['probe']: fails.append(f"{name}: network guard probe was not blocked")
    if r['blocked']: fails.append(f"{name}: unhandled requests were blocked, add a handler or remove the call: {r['blocked'][:5]}")
print('FAIL: ' + '; '.join(fails) if fails else 'PASS: live address saves; test link reads but never writes')
sys.exit(1 if fails else 0)
