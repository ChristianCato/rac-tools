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
6. The other core Setup fields (expected hires from other sources, the
   remaining-error adjustment, include months still settling) reach the plan,
   and a month still settling is flagged on Setup.
7. Where the spending caps put the target out of reach, the Plan tab shows the
   most hires, the budget where hires stop rising and multiples 1 to 3, equal
   to the planner.
8. A broken assumptions.csv stops the app, naming the row.
9. "Use those counts instead" on Setup sets that role's open roles to RAC's
   plan column, leaves the other role's alone, and raises no page error.
10. Nothing is written to the database; every request is handled or blocked.

Run from the repo folder:  python tests/browser/app_checks.py  [--libs DIR]
Screenshots are written to tests/browser/out/."""
import gzip, json, os, re, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from guard import ROOT, TEST, new_page, libs_arg

OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
LIBS = libs_arg(sys.argv)
from app_fixture import PMAP, SMR_VAC, PATROL_VAC, working, workspace, DB, EXPECTED_JS, ONERAC_JS


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

    # October plan: platform fees shown, with the planner's total.
    fees_panel = page.locator('[data-panel="fees"]')
    fee_text = f"£{want['fees']:,.0f}"
    if not want['feesOn'] or fees_panel.count() != 1 or fee_text not in fees_panel.inner_text():
        fails.append(f"fees line missing or not {fee_text}: {fees_panel.inner_text()[:200] if fees_panel.count() else 'not shown'}")
    else:
        notes.append(f"October plan fees: Plan tab shows {fee_text}, as the planner")

    # Out of reach at a 200% multiple on this data: the panel shows the planner's figures.
    reach = want['reach']
    panel = page.locator('[data-panel="reach"]')
    if not reach:
        fails.append('expected 30 SMR hires to be out of reach on this data')
    elif panel.count() != 1:
        fails.append('out-of-reach panel not shown')
    else:
        text = panel.inner_text()
        rows = panel.locator('tbody tr').all_inner_texts()
        most = f"{reach['mostHires']:.1f}"
        sat = f"£{reach['saturationBudget']:,.0f}"
        if most not in text or sat not in text or len(rows) != 3:
            fails.append(f'out-of-reach panel does not match the planner ({most}, {sat}): {text[:300]}')
        for r, row in zip(reach['byMultiple'], rows):
            if f"{r['hiresAtBudget']:.1f}" not in row:
                fails.append(f"multiple {r['multiple']} row {row!r} lacks {r['hiresAtBudget']:.1f} hires")
        kpi = page.locator('.kpi:has(.kpi-label:has-text("Budget to hit target"))').inner_text()
        if 'Most ' + most not in kpi:
            fails.append('budget KPI does not show the most hires: ' + kpi)
        notes.append(f"out of reach: most {most} hires at {sat}; rows " + ' | '.join(x.replace(chr(9), ' ') for x in rows))

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
    box.press('Enter')
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
    # The other core Setup fields.
    page.locator('.tab-btn', has_text='Setup').first.click()
    page.locator('input[data-field="other-hires-share-SMR"]').wait_for(timeout=30000)
    for field, value in (('other-hires-monthly-SMR', '12'), ('remaining-error-SMR', '1.2')):
        f = page.locator(f'input[data-field="{field}"]')
        f.fill(value)
        f.press('Enter')
        page.wait_for_timeout(400)
    page.locator('input[data-field="include-settling"]').first.check()
    page.wait_for_timeout(800)
    setup_text = page.locator('[data-panel="core-settings-SMR"]').inner_text()
    if 'not yet settled, figures may change' not in setup_text or 'Aug' not in setup_text:
        fails.append('Setup does not flag August as not yet settled: ' + setup_text[-300:])
    if 'Average since Mar' not in setup_text:
        fails.append('Setup does not show the average since March 2026')
    page.screenshot(path=os.path.join(OUT, 'setup_core_settings.png'), full_page=True)
    page.locator('.tab-btn', has_text='Plan').first.click()
    role_button(page, 'SMR')
    core_shown = kpis(page)
    core_want = page.evaluate(EXPECTED_JS.replace(
        'p.otherHiresShare = (w.otherHiresShare || {})[role] ?? null;',
        'p.otherHiresShare = role === "SMR" ? 0.5 : null;'
    ).replace('p.otherHiresMonthly = (w.otherHiresMonthly || {})[role] ?? null;', 'p.otherHiresMonthly = role === "SMR" ? 12 : null;'
    ).replace('p.remainingError = (w.remainingError || {})[role] ?? null;', 'p.remainingError = role === "SMR" ? 1.2 : null;'
    ).replace('p.includeSettling = !!w.includeSettling;', 'p.includeSettling = true;'), 'SMR')
    notes.append(f"Setup 12 other-source hires a month, adjustment 1.2, months still settling on: SMR {core_shown} (planner {core_want['apps']:.1f}, {core_want['hires']:.2f}; months still settling used {core_want['settling']})")
    if core_shown != (round(core_want['apps']), round(core_want['hires'], 1)) or core_want['settling'] != ['2026-08']:
        fails.append(f'Plan tab after the core fields {core_shown} differs from the planner {core_want}')
    for tab in ('Setup', 'Platforms', 'Method'):
        page.locator('.tab-btn', has_text=tab).first.click()
        page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(OUT, 'method.png'))
    # Method tab: the shared text, with this plan's values, and the version stamp.
    method = page.locator('[data-panel="method"]')
    if method.count() != 1:
        fails.append('Method tab not shown')
    else:
        mt = method.inner_text()
        needed = ['Platform fees', 'Spending caps', 'Testing and agreed settings', 'Code b0a7d5c', 'rate of 0.65', '1.096']
        missing = [n for n in needed if n not in mt]
        if missing:
            fails.append(f'Method tab lacks {missing}')
        if '—' in mt or 'Hiring Lab' in mt:
            fails.append('Method tab text fails the output checks')
        notes.append('Method tab: shared text shown with the version stamp "' + [l for l in mt.splitlines() if l.startswith('Code ')][0][:80] + '..."' if 'Code ' in mt else 'Method tab: no stamp line')
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
    # carried a plan column. Clicking it for SMR must pin SMR's counts to the
    # plan column (twice the live counts here) and leave Patrol's as they are.
    import copy
    db2 = copy.deepcopy(DB)
    rows = lambda vac, k: [{'location': r + ' depot', 'region': r, 'plan': n * k, 'v': {'2026-09-15': n}} for r, n in vac.items()]
    db2['workspace']['months']['2026-10']['priorities'] = {
        'dates': ['2026-09-15'], 'budgets': {}, 'thresholds': {},
        'roles': {'SMR': {'rows': rows(SMR_VAC, 2)}, 'Patrol': {'rows': rows(PATROL_VAC, 3)}}}
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
        regions = page.evaluate('window.__AVP_DATA__.regions_ordered')
        values = page.locator('.loc-toggle .vac-input').evaluate_all('els => els.map(e => Number(e.value))')
        smr_want = [2 * SMR_VAC.get(r, 0) for r in regions]
        patrol_want = [PATROL_VAC.get(r, 0) for r in regions]
        notes.append(f'"Use those counts instead" ({n_links} links, SMR clicked): pinned {pinned}; SMR {values[:len(regions)]}; Patrol {values[len(regions):]}; page errors {errors[:2] or "none"}')
        if errors:
            fails.append(f'"Use those counts instead" raised page errors: {errors[:2]}')
        if not pinned or values != smr_want + patrol_want:
            fails.append(f'"Use those counts instead" gave {values}, expected SMR {smr_want} and Patrol unchanged {patrol_want}')
    except Exception as e:
        fails.append('"Use those counts instead" could not be tested: ' + str(e)[:160])
    page.screenshot(path=os.path.join(OUT, 'use_those_counts.png'))
    if guard.blocked or guard.writes:
        fails.append(f'use-counts run: blocked {guard.blocked[:3]}, writes {guard.writes[:3]}')
    ctx.close()

    # A location minimum above what the spending caps allow: the caps hold and
    # the Plan tab lists the shortfall, as the planner words it.
    db3 = copy.deepcopy(DB)
    db3['workspace']['months']['2026-10']['working']['regionMin']['SMR'] = {'Scotland': 9000}
    ctx, page, guard, errors = new_page(browser, TEST, db=db3, libs=LIBS)
    page.goto(TEST + '#planner/plan')
    page.wait_for_selector('.app-header', timeout=60000)
    role_button(page, 'SMR')
    kpis(page)
    want3 = page.evaluate(EXPECTED_JS.replace('regionMin: w.regionMin[role]', "regionMin: role === 'SMR' ? { Scotland: 9000 } : w.regionMin[role]"), 'SMR')
    panel = page.locator('[data-panel="minimum-shortfalls"]')
    if not want3['shortfalls']:
        fails.append('expected the planner to report a Scotland shortfall')
    elif panel.count() != 1:
        fails.append('minimum shortfall notice not shown')
    else:
        text = panel.inner_text()
        missing = [t for t in want3['shortfalls'] if t not in text]
        if missing:
            fails.append(f'shortfall notice lacks {missing}: {text[:200]}')
        notes.append('minimum above the caps: Plan tab shows "' + '; '.join(want3['shortfalls']) + '"')
    page.screenshot(path=os.path.join(OUT, 'minimum_shortfall.png'))
    if errors or guard.blocked or guard.writes:
        fails.append(f'shortfall run: errors {errors[:2]}, blocked {guard.blocked[:3]}, writes {guard.writes[:3]}')
    ctx.close()

    # OneRAC: London on OneRAC from this month. The OneRAC tab shows its own
    # plan, and the SMR plan loses London and carries the hold-back.
    db4 = copy.deepcopy(DB)
    db4['workspace']['months']['2026-10']['working']['oneRac'] = {
        'locations': [{'region': 'London', 'from': '2026-10'}],
        'budget': 20000, 'hireTarget': 6, 'fundFromRoles': True, 'selfCompetition': None,
        'premiumCampaigns': 0, 'acReserve': 0,
        'platMin': {}, 'platMax': {}, 'coverage': {}, 'regionMin': {}, 'regionMax': {},
    }
    # London is off in the fixture's SMR plan; give it spend so the exclusion shows.
    db4['workspace']['months']['2026-10']['working']['regionMax']['SMR'] = {
        k: v for k, v in DB['workspace']['months']['2026-10']['working']['regionMax']['SMR'].items() if k != 'London'}
    ctx, page, guard, errors = new_page(browser, TEST, db=db4, libs=LIBS)
    page.goto(TEST + '#planner/onerac')
    page.wait_for_selector('[data-panel="onerac-setup"]', timeout=60000)
    page.wait_for_timeout(600)
    want4 = page.evaluate(ONERAC_JS, {'role': 'SMR', 'setup': db4['workspace']['months']['2026-10']['working']['oneRac']})
    panel = page.locator('[data-panel="onerac-plan"]')
    if panel.count() != 1:
        fails.append('the OneRAC tab shows no plan')
    else:
        text = panel.inner_text()
        for want in [f"{round(want4['apps']):,}", f"{want4['hires']:.1f}", 'London']:
            if want not in text:
                fails.append(f'OneRAC plan does not show {want!r}: {text[:200]}')
    if want4['roleHasThem']:
        fails.append('London is still in the SMR plan while it is on OneRAC')
    if abs(want4['holdback'] - 20000 * 18 / 30) > 1 or abs(want4['roleHoldback'] - round(want4['holdback'])) > 1:
        fails.append(f"SMR OneRAC hold-back {want4['roleHoldback']} against the open-roles split {want4['holdback']}")
    if want4['locations'] != ['London']:
        fails.append(f"the OneRAC plan covers {want4['locations']}")
    notes.append(f"OneRAC tab: {want4['regions']}, {want4['openRoles']} open roles, "
                 f"{want4['apps']:.0f} applications and {want4['hires']:.1f} hires = the planner; "
                 f"role-mix adjustment x{want4['adjustment']:.3f}, self-competition {want4['selfCompetition']:.0%}; "
                 f"London out of the SMR plan, hold-back \u00a3{want4['roleHoldback']:,.0f}")
    # The Assumptions tab lists every value with where it came from.
    page.locator('.tab-btn', has_text='Assumptions').click()
    page.wait_for_selector('[data-panel="assumptions"]', timeout=30000)
    page.wait_for_timeout(800)
    rows = page.locator('[data-panel="assumptions"] .alloc-table tbody tr').count()
    want_rows = page.evaluate("(role) => RAC.text.assumptionRows(RAC.app.state.A, role, null).length", 'SMR')
    if rows < want_rows:
        fails.append(f'the Assumptions tab lists {rows} values, the file holds at least {want_rows}')
    body = page.inner_text('[data-panel="assumptions"]')
    low = body.lower()
    for want in ['assumptions.csv', 'agreed, informed by tests', 'testing gave', 'quality rate blend strength']:
        if want not in low:
            fails.append(f'the Assumptions tab does not show {want!r}')
    notes.append(f'Assumptions tab: {rows} values with their source, date and tested figure')
    # The market guide on Setup: read from data/market.json, cost in pounds.
    page.locator('.tab-btn', has_text='Setup').click()
    page.wait_for_selector('[data-panel="market"]', timeout=30000)
    page.wait_for_timeout(600)
    market_rows = page.locator('[data-panel="market"] tbody tr').count()
    market_text = page.inner_text('[data-panel="market"]')
    if market_rows < 10:
        fails.append(f'the market table shows {market_rows} months')
    if 'in pounds' not in market_text or '£' not in market_text:
        fails.append('the market table does not show cost in pounds')
    notes.append(f'market guide on Setup: {market_rows} months of cost in pounds and search interest')
    page.screenshot(path=os.path.join(OUT, 'assumptions.png'), full_page=True)
    page.screenshot(path=os.path.join(OUT, 'onerac.png'), full_page=True)
    if errors or guard.blocked or guard.writes:
        fails.append(f'OneRAC run: errors {errors[:2]}, blocked {guard.blocked[:3]}, writes {guard.writes[:3]}')
    ctx.close()

    # Cost limits (D6) in a page of their own, so nothing set earlier is in the way.
    ctx, page, guard, errors = new_page(browser, TEST, db=copy.deepcopy(DB), libs=LIBS)
    page.goto(TEST + '#planner/setup')
    page.wait_for_selector('[data-panel="cost-limits-SMR"]', timeout=60000)
    page.wait_for_timeout(800)
    # Cost limits (D6): setting one reaches the plan and the spend comes down.
    panel = page.locator('[data-panel="cost-limits-SMR"]')
    if panel.count() != 1:
        fails.append('no cost limits panel on Setup')
    else:
        before_plan = page.evaluate(EXPECTED_JS, 'SMR')
        box = page.locator('[data-field="cpa-SMR-South East-indeed"]')
        box.click(); box.fill('45'); box.press('Tab')
        page.wait_for_timeout(2000)
        line = "    daysInMonth: window.__AVP_DATA__.days_in_month[month], capMultiple: w.capMultiple, bench: w.bench[role], planMonth: month,"
        want_limit = page.evaluate(EXPECTED_JS.replace(
            line,
            line + "\n    limits: role === 'SMR' ? { cph: {}, cpa: { 'South East': { indeed: 45 } } } : { cph: {}, cpa: {} },"), 'SMR')
        page.locator('.tab-btn', has_text='Plan').first.click()
        page.wait_for_timeout(800)
        after = kpis(page)
        if abs(after[0] - want_limit['apps']) > 1:
            fails.append(f'with a cost per application limit the screen showed {after[0]} applications, the planner {want_limit["apps"]:.0f}')
        if abs(want_limit['apps'] - before_plan['apps']) < 1:
            fails.append('the cost per application limit changed nothing, so this check proves nothing')
        notes.append(f"cost limits: South East Indeed held to £45 an application moved the plan from "
                     f"{before_plan['apps']:.0f} to {after[0]} applications, as the planner says")
    if errors or guard.blocked or guard.writes:
        fails.append(f'cost limits run: errors {errors[:2]}, blocked {guard.blocked[:3]}, writes {guard.writes[:3]}')
    page.screenshot(path=os.path.join(OUT, 'cost_limits.png'), full_page=True)
    ctx.close()
    browser.close()

for n in notes:
    if n:
        print('  ' + n)
print('FAIL: ' + '; '.join(fails) if fails else 'PASS: planner loads, screens match it, settings stay put, a broken file stops the app, nothing written')
sys.exit(1 if fails else 0)
