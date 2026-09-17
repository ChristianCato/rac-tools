"""Browser check for the archive app (addendum 2.9): the read-only copy of the
app as it was before this release, for the plans made in it.

1. It opens, shows the archive banner, and plans.
2. It reads only the release-day copy (archive:workspace, archive:benchmarks,
   archive:hire_rates), never the live keys.
3. It never writes, even when a setting is changed.
4. Its figures do not depend on how fast the database answers. The live app's
   figures did: it worked out its month list before the answer arrived, and
   months held only in the database carried no weight. The archive replays that
   deliberately, so a slow answer must give the same figures as a fast one.

Run from the repo folder:  python tests/browser/archive_checks.py  [--libs DIR]
Screenshots are written to tests/browser/out/."""
import copy, os, re, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from guard import LIVE, new_page, libs_arg
from app_fixture import DB

OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
LIBS = libs_arg(sys.argv)
LIVE_KEYS = ('workspace', 'benchmarks', 'hire_rates')

# The release-day copy: the same saved plans and data, under the archive's own
# keys. The live keys are left out, so a read of one would show up as a miss.
db = {
    'archive:workspace': copy.deepcopy(DB['workspace']),
    'archive:benchmarks': copy.deepcopy(DB['benchmarks']),
}

fails, notes = [], []


def figures(page):
    page.wait_for_selector('.kpi-label:has-text("Predicted applications")', timeout=60000)
    page.wait_for_timeout(1500)
    return page.locator('.kpi .kpi-value').all_inner_texts()


with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # 1 to 3. The archive as it will be used.
    ctx, page, guard, errors = new_page(browser, LIVE, db=copy.deepcopy(db), libs=LIBS)
    page.goto(LIVE + 'archive/#planner/plan')
    quick = figures(page)
    banner = page.locator('[data-panel="archive-banner"]')
    if banner.count() != 1:
        fails.append('no archive banner')
    elif 'Archive: pre-release plans, read-only' not in banner.inner_text():
        fails.append('the banner does not say it is the archive: ' + banner.inner_text()[:120])
    if not quick or not any(re.search(r'\d', v) for v in quick):
        fails.append(f'the archive showed no figures: {quick[:4]}')
    live_reads = [k for k in guard.reads if k in LIVE_KEYS]
    if live_reads:
        fails.append(f'the archive read the live keys: {sorted(set(live_reads))}')
    archive_reads = sorted({k for k in guard.reads if str(k).startswith('archive:')})
    if 'archive:workspace' not in archive_reads:
        fails.append(f'the archive did not read its own copy: {guard.reads[:6]}')
    # Change a setting: still nothing written.
    page.locator('.tab-btn', has_text='Setup').click()
    page.wait_for_selector('input.text-input', timeout=30000)
    box = page.locator('input.text-input').first
    box.click(); box.press('End'); box.type('1'); box.press('Tab')
    page.wait_for_timeout(2500)
    if guard.writes:
        fails.append(f'the archive wrote to the database: {guard.writes[:3]}')
    notes.append(f'archive opened: banner shown, {len(archive_reads)} archive keys read ({", ".join(archive_reads)}), '
                 f'no live keys, {len(guard.writes)} writes after changing a setting')
    page.screenshot(path=os.path.join(OUT, 'archive.png'))
    if errors:
        fails.append(f'page errors: {errors[:3]}')
    ctx.close()

    # 4. The same thing with a slow database. The figures must not move.
    ctx, page, guard2, errors2 = new_page(browser, LIVE, db=copy.deepcopy(db), libs=LIBS,
                                          slow={'archive:benchmarks': 3.0, 'archive:hire_rates': 3.0})
    page.goto(LIVE + 'archive/#planner/plan')
    slow = figures(page)
    page.wait_for_timeout(2500)
    slow_after = figures(page)
    if quick != slow:
        fails.append(f'a slow database changed the archive figures: {quick[:3]} against {slow[:3]}')
    if slow != slow_after:
        fails.append(f'the archive figures moved while it was open: {slow[:3]} against {slow_after[:3]}')
    notes.append(f'with the database answering 3 seconds late the figures were identical ({", ".join(quick[:3])})')
    if errors2:
        fails.append(f'page errors on the slow run: {errors2[:3]}')
    if guard2.writes:
        fails.append(f'the archive wrote on the slow run: {guard2.writes[:3]}')
    ctx.close()
    browser.close()

for n in notes:
    print('  ' + n)
print('FAIL: ' + '; '.join(fails) if fails else
      'PASS: the archive opens read-only on its own copy, writes nothing, and gives the same figures however slow the database is')
sys.exit(1 if fails else 0)
