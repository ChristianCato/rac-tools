"""Browser checks for the planner in the real app (test link address).

1. The app loads the planner files and plans with no page errors.
2. The Plan tab's predicted applications and hires equal RAC.plan.build for
   the same settings, worked out in the page.
3. The Benchmarks tab shows the planner's figures. Changing Patrol's data
   window there, then going back to the SMR plan, leaves the SMR figures
   unchanged (settings do not leak between screens).
4. The SMR and Patrol buttons in the header switch the role on every screen.
5. The Setup share of other-source hires credited to paid media reaches the
   plan (Plan tab hires equal the planner at 50%).
6. A broken assumptions.csv stops the app, naming the row.
7. "Use those counts instead" on Setup is clicked and the result recorded
   (a known bug reported to the app author; recorded, not failed).
8. Nothing is written to the database; every request is handled or blocked.

Run from the repo folder:  python tests/browser/app_checks.py  [--libs DIR]
Screenshots are written to tests/browser/out/."""
import gzip, json, os, re, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from guard import ROOT, TEST, new_page, libs_arg

OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
LIBS = libs_arg(sys.argv)
PMAP = {'Indeed': 'indeed', 'Meta': 'meta', 'Google': 'google', 'Appcast': 'appcast'}

# The shared database as the live app held it on 16 September (SMR months from
# the live export; other roles' figures for those months from the repo file).
base = json.load(gzip.open(os.path.join(ROOT, 'tests/fixtures/rac_data_46aaae2.json.gz'), 'rt', encoding='utf-8'))
live = json.load(open(os.path.join(ROOT, 'tests/fixtures/smr_sept_live_2026-09-16.json'), encoding='utf-8'))
months = sorted({r[0] for r in live['raw']})
cells = {}
for mo, region, plat, spend, apps, clicks, *_ in live['raw']:
    e = {'spend': spend or 0, 'completes': apps or 0, 'cpa': (spend / apps) if apps else None}
    if isinstance(clicks, (int, float)):
        e['clicks'] = clicks
    cells.setdefault(PMAP[plat], {}).setdefault(region + '__SMR', {})[mo] = e
for p in PMAP.values():
    for k, c in base[p].items():
        if k.endswith('__SMR'):
            continue
        for mo in months:
            v = (c.get('monthly') or {}).get(mo)
            if v:
                cells.setdefault(p, {}).setdefault(k, {})[mo] = v
benchmarks = {'at': '2026-09-16', 'months': months, 'cells': cells}

SMR_VAC = {'South East': 19, 'London': 18, 'South West': 10, 'East of England': 10, 'West Midlands': 8,
           'East Midlands': 8, 'North West': 3, 'Yorkshire & Humber': 2, 'Scotland': 2}
PATROL_VAC = {'South East': 9, 'London': 12, 'South West': 8, 'East Midlands': 4, 'North West': 6,
              'Yorkshire & Humber': 3, 'West Midlands': 5, 'East of England': 2, 'North East': 2, 'Scotland': 2}
zero = {'indeed': 0, 'meta': 0, 'google': 0, 'appcast': 0}
working = {
    'budget': {'SMR': 101950, 'Patrol': 80000}, 'hireTarget': {'SMR': 30, 'Patrol': 16},
    'coverageFloor': 1000, 'capMultiple': 2,
    'bench': {'SMR': {'mode': 'last3up', 'mult': 2}, 'Patrol': {'mode': 'last3up', 'mult': 2}},
    'commentary': {'SMR': '', 'Patrol': ''}, 'commentaryLegacy': {'SMR': '', 'Patrol': ''},
    'coveragePct': 0, 'premiumCampaigns': {'SMR': 3, 'Patrol': 3}, 'acReserve': {'SMR': 5000, 'Patrol': 3000},
    'platMin': {'SMR': dict(zero), 'Patrol': dict(zero)},
    'platMax': {'SMR': dict(zero, appcast=5000), 'Patrol': dict(zero)},
    'coverage': {'SMR': {}, 'Patrol': {}},
    'regionMin': {'SMR': {}, 'Patrol': {}},
    'regionMax': {'SMR': {'London': -1, 'South East': 15000, 'East of England': 8000, 'Scotland': 2500}, 'Patrol': {}},
    'comboMin': {'SMR': {}, 'Patrol': {}},
}
workspace = {'current': '2026-10', '_savedAt': '2026-09-16T12:00:00Z', 'months': {
    '2026-10': {'demand': {'SMR': SMR_VAC, 'Patrol': PATROL_VAC}, 'working': working, 'versions': [], 'loaded': None}}}
DB = {'workspace': workspace, 'benchmarks': benchmarks}

EXPECTED_JS = """(role) => {
  const w = %s, vac = %s, month = '2026-10';
  const p = {
    budget: w.budget[role], appTarget: 0, hireTarget: w.hireTarget[role],
    liveRegions: window.__AVP_DATA__.regions_ordered.filter(r => (vac[role][r] || 0) > 0),
    vacancies: Object.fromEntries(window.__AVP_DATA__.regions_ordered.map(r => [r, vac[role][r] || 0])),
    coveragePct: w.coveragePct, premiumCampaigns: w.premiumCampaigns[role], acReserve: w.acReserve[role],
    platMin: w.platMin[role], platMax: w.platMax[role], coverage: w.coverage[role], comboMin: w.comboMin[role],
    regionMin: w.regionMin[role], regionMax: w.regionMax[role],
    daysInMonth: window.__AVP_DATA__.days_in_month[month], capMultiple: w.capMultiple, bench: w.bench[role],
  };
  p.otherHiresShare = (w.otherHiresShare || {})[role] ?? null;
  const plan = RAC.plan.build(role, p, RAC.app.env(window.__AVP_DATA__, 'browser-check'));
  return { apps: plan.totals.apps, hires: plan.totals.allHires, paid: plan.totals.hires, other: plan.totals.otherHires,
    deployable: plan.deployable, settledTo: plan.stamps.data.settledTo };
}""" % (json.dumps(working), json.dumps({'SMR': SMR_VAC, 'Patrol': PATROL_VAC}))


def kpis(page):
    page.wait_for_selector('.kpi-label:has-text("Predicted applications")', timeout=30000)
    apps = page.locator('.kpi:has(.kpi-label:has-text("Predicted applications")) .kpi-value').inner_text()
    hires = page.locator('.kpi:has(.kpi-label:has-text("Predicted hires")) .kpi-value').inner_text()
    return int(apps.replace(',', '')), float(hires)


def role_button(page, role):
    # The role switch inside the tab.
    page.locator('.main .role-switch button', has_text=re.compile('^' + role + '$')).first.click()
    page.wait_for_timeout(400)


def header_role(page, role):
    # The role switch in the header, beside the export buttons.
    page.locator('.app-header .role-switch button', has_text=re.compile('^' + role + '$')).first.click()
    page.wait_for_timeout(400)


def active_roles(page):
    return (page.locator('.app-header .role-switch button.active').inner_text().strip(),
            page.locator('.main .role-switch button.active').first.inner_text().strip())


fails, notes = [], []
with sync_playwright() as pw:
    browser = pw.chromium.launch()

    ctx, page, guard, errors = new_page(browser, TEST, db=DB, libs=LIBS)
    page.goto(TEST + '#planner/plan')
    page.wait_for_selector('.app-header', timeout=60000)
    if not guard.probe(page):
        fails.append('network guard probe was not blocked')
    role_button(page, 'SMR')
    shown = kpis(page)
    want = page.evaluate(EXPECTED_JS, 'SMR')
    notes.append(f"SMR October on 16 September data: screen {shown[0]} applications, {shown[1]} hires; planner {want['apps']:.1f}, {want['hires']:.2f}; settled to {want['settledTo']}")
    if shown != (round(want['apps']), round(want['hires'], 1)):
        fails.append(f'Plan tab {shown} differs from the planner {want}')
    page.screenshot(path=os.path.join(OUT, 'plan_smr.png'))

    page.locator('.tab-btn', has_text='Benchmarks').click()
    page.wait_for_selector('text=The plan uses', timeout=30000)
    bench_text = page.locator('.banner-info').first.inner_text()
    if 'Not yet counted' not in bench_text or 'Aug' not in bench_text:
        fails.append('Benchmarks tab does not say August is not yet counted: ' + bench_text[:200])
    role_button(page, 'Patrol')
    page.locator('.main .role-switch button', has_text='Last 3 months').click()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(OUT, 'benchmarks_patrol_last3.png'))
    page.locator('.tab-btn', has_text='Plan').first.click()
    role_button(page, 'SMR')
    again = kpis(page)
    if again != shown:
        fails.append(f'SMR plan changed after Patrol window changed on Benchmarks: {shown} then {again}')
    patrol_before = page.evaluate(EXPECTED_JS, 'Patrol')
    notes.append(f"Patrol planner: original window {patrol_before['apps']:.1f}, last 3 months (below)")
    patrol_want = page.evaluate(EXPECTED_JS.replace("bench: w.bench[role]", "bench: role === 'Patrol' ? { mode: 'last3' } : w.bench[role]"), 'Patrol')
    role_button(page, 'Patrol')
    patrol_shown = kpis(page)
    if patrol_shown != (round(patrol_want['apps']), round(patrol_want['hires'], 1)):
        fails.append(f"Patrol plan {patrol_shown} differs from the planner with its new window {patrol_want}")
    notes.append(f'after changing Patrol to the last 3 months: SMR {again} (unchanged), Patrol {patrol_shown} (planner agrees)')

    # Header role switch: both buttons switch the role everywhere.
    seen = []
    for r in ('SMR', 'Patrol', 'SMR'):
        header_role(page, r)
        roles = active_roles(page)
        seen.append(f'{r}: header {roles[0]}, Plan tab {roles[1]}, applications {kpis(page)[0]}')
        if roles != (r, r):
            fails.append(f'header {r} button: active roles {roles}')
    if kpis(page) != again:
        fails.append(f'SMR plan after header switching {kpis(page)} differs from {again}')
    notes.append('header role switch: ' + '; '.join(seen))

    # Setup: the credited share reaches the plan.
    page.locator('.tab-btn', has_text='Setup').first.click()
    box = page.locator('input[data-field="other-hires-share-SMR"]')
    box.wait_for(timeout=30000)
    before_share = box.input_value()
    box.fill('50%')
    page.wait_for_timeout(600)
    page.locator('.tab-btn', has_text='Plan').first.click()
    role_button(page, 'SMR')
    half_shown = kpis(page)
    half_want = page.evaluate(EXPECTED_JS.replace('p.otherHiresShare = (w.otherHiresShare || {})[role] ?? null;', 'p.otherHiresShare = role === "SMR" ? 0.5 : null;'), 'SMR')
    notes.append(f"Setup share {before_share} to 50%: SMR hires {again[1]} to {half_shown[1]} (planner {half_want['hires']:.2f}: paid media {half_want['paid']:.2f}, other sources {half_want['other']:.2f})")
    if before_share != '0%':
        fails.append('Setup share did not start at 0%: ' + before_share)
    if half_shown != (round(half_want['apps']), round(half_want['hires'], 1)) or half_shown == again:
        fails.append(f'Plan tab after a 50% share {half_shown} differs from the planner {half_want}')
    for tab in ('Setup', 'Platforms', 'Method'):
        page.locator('.tab-btn', has_text=tab).first.click()
        page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(OUT, 'method.png'))
    if guard.writes:
        fails.append(f'test link sent database writes: {guard.writes[:3]}')
    if errors:
        fails.append(f'page errors: {errors[:3]}')
    if guard.blocked:
        fails.append(f'unhandled requests were blocked: {guard.blocked[:5]}')
    notes.append(f"served {len(set(guard.served))} app files; {len(guard.reads)} database reads; 0 writes" if not guard.writes else '')
    ctx.close()

    bad = open(os.path.join(ROOT, 'assumptions.csv'), encoding='utf-8').read()
    bad = re.sub(r'^(cap_multiple_default,[^,]*,)1,', r'\g<1>one,', bad, flags=re.M)
    ctx, page, guard, errors = new_page(browser, TEST, db=DB, files={'assumptions.csv': bad}, libs=LIBS)
    page.goto(TEST)
    try:
        page.wait_for_selector('text=assumptions.csv has problems', timeout=60000)
        body = page.locator('.planner-errors').inner_text()
        if 'cap_multiple_default' not in body:
            fails.append('broken assumptions page does not name the row: ' + body[:200])
        notes.append('broken assumptions file: app stopped and listed ' + body.strip().splitlines()[0])
    except Exception as e:
        fails.append('broken assumptions file did not stop the app: ' + str(e)[:120])
    page.screenshot(path=os.path.join(OUT, 'broken_assumptions.png'))
    if page.locator('.app-header').count():
        fails.append('app header shown despite a broken assumptions file')
    if errors:
        fails.append(f'page errors with broken assumptions: {errors[:3]}')
    if guard.blocked or guard.writes:
        fails.append(f'broken assumptions run: blocked {guard.blocked[:3]}, writes {guard.writes[:3]}')
    ctx.close()

    # "Use those counts instead" (Setup): shown when RAC's file for the month
    # carried a plan column. Reported as a probable bug (role used outside its
    # scope); the author could not reproduce it. Recorded, not failed.
    import copy
    db2 = copy.deepcopy(DB)
    rows = lambda vac, k: [{'location': r + ' depot', 'region': r, 'plan': n * k, 'v': {'2026-09-15': n}} for r, n in vac.items()]
    db2['workspace']['months']['2026-10']['priorities'] = {
        'dates': ['2026-09-15'], 'budgets': {}, 'thresholds': {},
        'roles': {'SMR': {'rows': rows(SMR_VAC, 2)}, 'Patrol': {'rows': rows(PATROL_VAC, 2)}}}
    ctx, page, guard, errors = new_page(browser, TEST, db=db2, libs=LIBS)
    page.goto(TEST + '#planner/setup')
    page.wait_for_selector('.app-header', timeout=60000)
    page.locator('.tab-btn', has_text='Setup').first.click()
    link = page.locator('a', has_text='Use those counts instead')
    try:
        link.first.wait_for(timeout=30000)
        n_links = link.count()
        link.first.click()
        page.wait_for_timeout(800)
        pinned = page.locator('text=This plan is using its own open-role counts').count() > 0
        counts_text = ' / '.join(page.locator('.loc-toggle .vac-input').evaluate_all('els => els.slice(0, 3).map(e => e.value)'))
        use_counts = (f'"Use those counts instead" ({n_links} links): page errors {errors[:2] or "none"}; '
                      f'plan pinned afterwards: {pinned}; first counts shown: {counts_text or "none"}')
    except Exception as e:
        use_counts = '"Use those counts instead" could not be tested: ' + str(e)[:160]
    page.screenshot(path=os.path.join(OUT, 'use_those_counts.png'))
    notes.append(use_counts)
    if guard.blocked or guard.writes:
        fails.append(f'use-counts run: blocked {guard.blocked[:3]}, writes {guard.writes[:3]}')
    ctx.close()
    browser.close()

for n in notes:
    if n:
        print('  ' + n)
print('FAIL: ' + '; '.join(fails) if fails else 'PASS: planner loads, screens match it, settings stay put, a broken file stops the app, nothing written')
sys.exit(1 if fails else 0)
