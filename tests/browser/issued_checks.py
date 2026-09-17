"""Browser check for issued plans (C1 and C2), on the live address, because
issuing writes to the database.

1. "Mark as issued" stores a snapshot under its own key, once. The key holds a
   document for each role, and the plan carries the date it was issued.
2. A second attempt on the same plan is refused and writes nothing.
3. Opening an issued plan shows it from the snapshot: the screens show the
   stored figures even after the data behind them changes, and the banner says
   so. A draft in the same month follows the new data, so the two differ.
4. An issued plan cannot be renamed or deleted, and editing anything drops back
   to the working plan rather than changing what was sent.

Run from the repo folder:  python tests/browser/issued_checks.py  [--libs DIR]
Screenshots are written to tests/browser/out/."""
import copy, json, os, re, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from guard import LIVE, new_page, libs_arg
from app_fixture import DB, EXPECTED_JS

OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
LIBS = libs_arg(sys.argv)

fails, notes = [], []
db = copy.deepcopy(DB)
# One saved plan for October, not yet issued.
db['workspace']['months']['2026-10']['versions'] = [{
    'id': 'v1', 'name': 'RAC Media Budgets - October 2026 v1', 'note': '', 'saved': '2026-09-18T09:00:00Z',
    'planner': copy.deepcopy(db['workspace']['months']['2026-10']['working']),
    'demand': {}, 'bench': copy.deepcopy(db['workspace']['months']['2026-10']['working']['bench']), 'demandDate': None,
}]
db['workspace']['months']['2026-10']['loaded'] = 'v1'


def plan_select(page):
    # The month bar holds the month picker first, then the plan picker.
    return page.locator('.month-bar .mb-group:has(label:text-is("Plan")) select')


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx, page, guard, errors = new_page(browser, LIVE, db=db, libs=LIBS)
    dialogs = []
    page.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    page.goto(LIVE + '#planner/plan')
    page.wait_for_selector('.kpi-label:has-text("Predicted applications")', timeout=60000)
    page.wait_for_timeout(800)
    before = page.evaluate(EXPECTED_JS, 'SMR')

    # 1. Mark as issued.
    button = page.locator('button[data-action="mark-issued"]')
    if button.count() != 1:
        fails.append('no "Mark as issued" button on a saved plan')
    else:
        button.click()
        page.wait_for_timeout(2500)
        written = [(k, v) for k, v in guard.saved if str(k).startswith('issued:')]
        if len(written) != 1:
            fails.append(f'expected one write of the snapshot, got {len(written)}')
        # A second attempt must be refused, because the key now holds a snapshot.
        before_writes = len(guard.saved)
        if button.count():
            button.click()
            page.wait_for_timeout(2000)
        again = [(k, v) for k, v in guard.saved[before_writes:] if str(k).startswith('issued:')]
        if again:
            fails.append('a second "Mark as issued" wrote the key again')
    snap_keys = [k for k in guard.db if str(k).startswith('issued:')]
    if snap_keys != ['issued:2026-10:v1']:
        fails.append(f'snapshot keys {snap_keys}')
    else:
        snap = guard.db[snap_keys[0]]
        roles = [d['role'] for d in snap['docs']]
        if roles != ['SMR', 'Patrol']:
            fails.append(f'the snapshot holds {roles}')
        notes.append(f"snapshot under {snap_keys[0]}: {', '.join(roles)}, "
                     f"{round(len(json.dumps(snap)) / 1024)} KB, issued by {snap.get('issuedBy')}")
    page.screenshot(path=os.path.join(OUT, 'issued_marked.png'))
    ctx.close()

    # 2 to 4. Reopen with the snapshot in the database, and the data changed
    # underneath it, so a recalculation would give different figures.
    db2 = copy.deepcopy(db)
    if snap_keys:
        db2[snap_keys[0]] = guard.db[snap_keys[0]]
        db2['workspace']['months']['2026-10']['versions'][0]['issued'] = {
            'at': guard.db[snap_keys[0]]['issuedAt'], 'by': guard.db[snap_keys[0]]['issuedBy'],
            'key': snap_keys[0], 'roles': [d['role'] for d in guard.db[snap_keys[0]]['docs']],
            'fingerprint': guard.db[snap_keys[0]]['fingerprint'],
        }
    # Double every Indeed application in the shared months: a fresh calculation
    # would move, a snapshot must not.
    for key, cell in db2['benchmarks']['cells']['indeed'].items():
        for mo in cell:
            cell[mo]['completes'] = (cell[mo].get('completes') or 0) * 2
    ctx, page, guard, errors = new_page(browser, LIVE, db=db2, libs=LIBS)
    dialogs2 = []
    page.on('dialog', lambda d: (dialogs2.append(d.message), d.accept()))
    page.goto(LIVE + '#planner/plan')
    page.wait_for_selector('.kpi-label:has-text("Predicted applications")', timeout=60000)
    page.wait_for_selector('[data-panel="issued"]', timeout=30000)
    page.wait_for_timeout(1500)
    banner = page.locator('[data-panel="issued"]').inner_text()
    if 'was issued on' not in banner or 'what RAC was sent' not in banner:
        fails.append('the issued banner does not read as an open issued plan: ' + banner[:200])
    shown = page.locator('.kpi:has(.kpi-label:has-text("Predicted applications")) .kpi-value').inner_text()
    fresh = page.evaluate(EXPECTED_JS, 'SMR')
    if shown is None:
        fails.append('no predicted applications on screen')
    else:
        stored = round(before['apps'])
        on_screen = int(re.sub(r'[^0-9]', '', shown) or 0)
        if abs(on_screen - stored) > 1:
            fails.append(f'the issued plan shows {on_screen} applications, the snapshot holds {stored}')
        if abs(round(fresh['apps']) - stored) < 1:
            fails.append('the data change did not move a fresh calculation, so this check proves nothing')
        notes.append(f"opened from the snapshot: {on_screen} applications, as issued; the same settings on the changed data "
                     f"would now give {fresh['apps']:.0f}")
    # Rename and delete are refused; there is no button, and the guard stops the call.
    if page.locator('button:has-text("Rename")').count() or page.locator('button:has-text("Delete")').count():
        fails.append('Rename or Delete is offered on an issued plan')
    # Editing drops back to the working plan.
    page.locator('.tab-btn', has_text='Setup').click()
    page.wait_for_selector('input.text-input', timeout=30000)
    box = page.locator('input.text-input').first
    box.click(); box.press('End'); box.type('1'); box.press('Tab')
    page.wait_for_timeout(1500)
    picked = plan_select(page).input_value()
    if picked != '':
        fails.append(f'editing an issued plan left it loaded ({picked})')
    if page.locator('[data-panel="issued"]').count():
        fails.append('the issued banner is still shown after an edit')
    writes = [w for w in guard.writes if 'issued:' in (w[2] or '')]
    if writes:
        fails.append(f'{len(writes)} writes touched an issued key after it was stored')
    notes.append('editing an issued plan dropped back to the working plan; no write touched the stored snapshot')
    page.screenshot(path=os.path.join(OUT, 'issued_opened.png'))
    if errors:
        fails.append(f'page errors: {errors[:3]}')
    if guard.blocked:
        fails.append(f'blocked requests: {guard.blocked[:3]}')
    ctx.close()
    browser.close()

for n in notes:
    print('  ' + n)
print('FAIL: ' + '; '.join(fails) if fails else
      'PASS: a plan is issued once, opens from its snapshot, and cannot be renamed, deleted or written over')
sys.exit(1 if fails else 0)
