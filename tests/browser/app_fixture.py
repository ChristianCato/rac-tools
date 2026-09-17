"""The browser checks' shared state: the shared database as the live app
held it on 16 September, an October 2026 working plan, and EXPECTED_JS, which
builds the same plan with the planner inside the page."""
import gzip, json, os
from guard import ROOT

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
    daysInMonth: window.__AVP_DATA__.days_in_month[month], capMultiple: w.capMultiple, bench: w.bench[role], planMonth: month,
  };
  p.otherHiresShare = (w.otherHiresShare || {})[role] ?? null;
  p.otherHiresMonthly = (w.otherHiresMonthly || {})[role] ?? null;
  p.remainingError = (w.remainingError || {})[role] ?? null;
  p.includeSettling = !!w.includeSettling;
  const plan = RAC.plan.build(role, p, RAC.app.env(window.__AVP_DATA__, 'browser-check'));
  return { apps: plan.totals.apps, hires: plan.totals.allHires, paid: plan.totals.hires, other: plan.totals.otherHires,
    deployable: plan.deployable, settledTo: plan.stamps.data.settledTo, reach: plan.reach,
    settling: plan.settlingUsed.map(x => x.month), shortfalls: plan.minimumShortfalls.map(x => x.text), fees: plan.fees.total, feesOn: plan.fees.on };
}""" % (json.dumps(working), json.dumps({'SMR': SMR_VAC, 'Patrol': PATROL_VAC}))
