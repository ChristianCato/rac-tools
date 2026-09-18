// Checks on the data window and upweighting (user, 18 September 2026): which
// parts of the model follow the window set for the plan, which follow a fixed
// rule, and that the PDF and the workings say which months every part used.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';
import { FakePDF } from '../lib/fake_pdf.mjs';

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const bt = JSON.parse(readRoot('data/backtest_results.json'));
  const D = calibrationData(RAC);
  const OCT = { ...septSmrSettings(RAC.plan.NO_SPEND), planMonth: '2026-10', daysInMonth: 31 };
  const WINDOWS = {
    all: { mode: 'all' }, ytd: { mode: 'ytd' }, last3: { mode: 'last3' },
    x2: { mode: 'last3up', mult: 2 }, x3: { mode: 'last3up', mult: 3 }, custom: { mode: 'custom', from: '2026-02', to: '2026-04' },
  };
  const plans = {};
  const build = (role, key) => (plans[role + key] ||= RAC.plan.build(role, { ...OCT, bench: WINDOWS[key] }, { ds: D[role].ds, A, eploy }));

  // The window rule written again here, apart from the planner.
  function weightsFor(months, w) {
    const last = months[months.length - 1], out = {};
    months.forEach((mo, i) => {
      const age = months.length - i, sameYear = mo.slice(0, 4) === last.slice(0, 4);
      out[mo] = w.mode === 'all' ? 1 : w.mode === 'ytd' ? (sameYear ? 1 : 0) : w.mode === 'last3' ? (age <= 3 ? 1 : 0)
        : w.mode === 'last3up' ? (!sameYear ? 0 : age <= 3 ? w.mult : 1) : ((mo < w.from || mo > w.to) ? 0 : 1);
    });
    return out;
  }
  const settledOf = (role) => { const s = RAC.data.monthStatus(D[role].ds, A); return D[role].ds.months.filter(mo => s[mo].settled); };

  check('Data window: cost per application in every row equals a direct weighted count, for six windows', () => {
    const out = [];
    for (const role of RAC.ROLES) {
      const ds = D[role].ds, settled = settledOf(role);
      let rows = 0;
      for (const key of Object.keys(WINDOWS)) {
        const plan = build(role, key), w = weightsFor(settled, WINDOWS[key]);
        assert(JSON.stringify(Object.fromEntries(Object.entries(plan.weights).filter(([, v]) => v > 0))) ===
          JSON.stringify(Object.fromEntries(Object.entries(w).filter(([, v]) => v > 0))), `${role} ${key}: weights ${JSON.stringify(plan.weights)}`);
        ds.regions.forEach(r => RAC.PLATFORMS.forEach(p => {
          const m = RAC.data.monthly(ds, p, r, role);
          let s = 0, a = 0;
          settled.forEach(mo => { if (m[mo] && w[mo] > 0) { s += w[mo] * m[mo].spend; a += w[mo] * m[mo].apps; } });
          const b = plan.blend.window[p][r];
          if (a > 0) { near(b.rawCpa, s / a, 1e-9, `${role} ${key} ${r} ${p} historic cost per application`); rows++; }
        }));
      }
      out.push(`${role}: ${rows} rows`);
    }
    return out.join('; ') + ' matched a direct count across all, year to date, last three, x2, x3 and February to April';
  });

  check('Upweighting recent months moves cost per application towards those months, and the plan follows', () => {
    const out = [];
    for (const role of RAC.ROLES) {
      const ds = D[role].ds, settled = settledOf(role);
      const recent = settled.slice(-3), earlier = settled.filter(mo => mo.slice(0, 4) === recent[2].slice(0, 4) && !recent.includes(mo));
      let moved = 0, cells = 0;
      ds.regions.forEach(r => RAC.PLATFORMS.forEach(p => {
        const m = RAC.data.monthly(ds, p, r, role);
        const sum = (ms) => ms.reduce((t, mo) => (m[mo] ? [t[0] + m[mo].spend, t[1] + m[mo].apps] : t), [0, 0]);
        const [rs, ra] = sum(recent), [es, ea] = sum(earlier);
        if (!(ra > 0 && ea > 0) || Math.abs(rs / ra - es / ea) < 1e-9) return;
        cells++;
        const target = rs / ra;
        const at = (k) => build(role, k).blend.window[p][r].rawCpa;
        const d = ['ytd', 'x2', 'x3', 'last3'].map(k => Math.abs(at(k) - target));
        for (let i = 1; i < d.length; i++) assert(d[i] <= d[i - 1] + 1e-9, `${role} ${r} ${p}: upweighting moved it away from the recent months (${d.map(x => x.toFixed(2)).join(', ')})`);
        if (d[3] < d[0] - 1e-9) moved++;
      }));
      // The plan's own cost per application (placed spend over applications)
      // ranks the windows the same way as the role's window cost does.
      const roleCpa = (k) => { let s = 0, a = 0; Object.values(build(role, k).blend.window).forEach(byR => Object.values(byR).forEach(b => { s += b.spend || 0; a += b.apps || 0; })); return s / a; };
      const planCpa = (k) => { const q = build(role, k); return q.placed / q.totals.apps; };
      const keys = ['all', 'ytd', 'x2', 'x3', 'last3'];
      const byRole = [...keys].sort((x, y) => roleCpa(x) - roleCpa(y)).join(',');
      const byPlan = [...keys].sort((x, y) => planCpa(x) - planCpa(y)).join(',');
      assert(byRole === byPlan, `${role}: windows by cost ${byRole}, by the plan's cost ${byPlan}`);
      const up = recent.length && build(role, 'x3').totals.apps, flat = build(role, 'ytd').totals.apps;
      const dearer = roleCpa('x3') > roleCpa('ytd');
      assert(dearer ? up < flat : up > flat, `${role}: applications ${flat.toFixed(0)} to ${up.toFixed(0)} when recent months were ${dearer ? 'dearer' : 'cheaper'}`);
      out.push(`${role}: ${cells} rows moved towards ${RAC.text.fmt.span(recent)} (${moved} strictly); window cost ${roleCpa('ytd').toFixed(2)} to ${roleCpa('x3').toFixed(2)}, applications ${flat.toFixed(0)} to ${up.toFixed(0)}`);
    }
    return out.join('; ');
  });

  check('Parts that follow a fixed rule do not move with the data window', () => {
    const out = [];
    for (const role of RAC.ROLES) {
      const ref = build(role, 'x2');
      const fixed = (p) => JSON.stringify({
        quality: p.rates.screenMonths, hires: p.rates.hireMonths, roleScreen: p.rates.roleScreen, roleHire: p.rates.roleHire,
        platform: RAC.PLATFORMS.map(x => p.rates.platform[x].used), recon: p.factors.recon, other: p.otherSources.months, otherMonthly: p.otherHiresMonthly,
        adjustment: p.remainingError, ranges: p.ranges, rate: RAC.PLATFORMS.map(x => p.diminishingReturns[x].b), capMonths: p.capMonths,
        considered: p.locations.map(l => RAC.PLATFORMS.map(x => l.cells[x].ceilingMonths.map(m => m.month).join('|')).join('/')).join(';'),
      });
      for (const key of Object.keys(WINDOWS)) assert(fixed(build(role, key)) === fixed(ref), `${role}: a fixed part moved with the ${key} window`);
      // The caps' months stay put; whether each month was successful is judged
      // against the window's cost, so the caps themselves can move.
      const capSum = (k) => build(role, k).locations.reduce((t, l) => t + RAC.PLATFORMS.reduce((u, x) => u + l.cells[x].cap, 0), 0);
      out.push(`${role}: quality ${RAC.text.fmt.span(ref.rates.screenMonths)}, hires ${RAC.text.fmt.span(ref.rates.hireMonths)}, caps ${RAC.text.fmt.span(ref.capMonths)}, adjustment, ranges and rate unchanged across ${Object.keys(WINDOWS).length} windows (caps total £${Math.round(capSum('all')).toLocaleString('en-GB')} to £${Math.round(capSum('last3')).toLocaleString('en-GB')})`);
    }
    return out.join('; ');
  });

  check('The PDF and the workings state the months and weights used for every part, and follow the window', () => {
    const out = [];
    for (const role of RAC.ROLES) {
      const texts = {};
      for (const key of ['ytd', 'x3']) {
        const plan = build(role, key);
        const doc = { role, roleName: role, plan, commentary: { legacy: [], plan: [] } };
        const opts = { monthLabel: 'October 2026', planName: 'test', backtest: bt, code: { commit: 'feedface00' } };
        const pdf = RAC.pdf.build(FakePDF, [doc], opts), wb = RAC.workings.build([doc], opts);
        assert(!pdf.problems.length && !wb.problems.length, `${role} ${key}: ${pdf.problems.concat(wb.problems).join('; ')}`);
        const flat = (xs) => xs.join(' ').replace(/\s+/g, ' ');
        const rows = RAC.text.monthsUsed(plan.A, role, plan, bt);
        const keys = rows.map(r => r.key);
        ['cost', 'caps', 'quality', 'hires', 'other', 'testing', 'ranges', 'blends'].forEach(k => assert(keys.includes(k), `${role}: months used lacks ${k}`));
        const f = RAC.text.fmt;
        const must = [f.weighted(plan.weights), f.span(plan.capMonths), f.span(plan.rates.screenMonths), f.span(plan.rates.hireMonths),
          f.span(plan.otherSources.months.map(m => m.month)), f.span(bt.roles[role].applications.map(m => m.month))];
        for (const [name, t] of [['PDF', flat(pdf.texts)], ['workings', flat(wb.texts)]]) {
          must.forEach(m => assert(t.includes(m), `${role} ${key} ${name} does not state "${m}"`));
          rows.forEach(r => assert(t.includes(r.part), `${role} ${key} ${name} does not name "${r.part}"`));
        }
        texts[key] = { cost: f.weighted(plan.weights), quality: f.span(plan.rates.screenMonths) };
      }
      assert(texts.ytd.cost !== texts.x3.cost, `${role}: the stated months did not change with the window`);
      assert(texts.ytd.quality === texts.x3.quality, `${role}: the quality months changed with the window`);
      out.push(`${role}: "${texts.x3.cost}" against "${texts.ytd.cost}"`);
    }
    return out.join('; ');
  });

  check('Wording for months and weights', () => {
    const f = RAC.text.fmt;
    assert(f.span(['2025-10', '2025-11', '2025-12', '2026-01']) === 'October 2025 to January 2026', f.span(['2025-10', '2025-11', '2025-12', '2026-01']));
    assert(f.span(['2026-01', '2026-02', '2026-04']) === 'January to February 2026 and April 2026', f.span(['2026-01', '2026-02', '2026-04']));
    assert(f.weighted({ '2026-01': 1, '2026-02': 1, '2026-03': 2 }) === 'January to February 2026 counted once and March 2026 counted twice', f.weighted({ '2026-01': 1, '2026-02': 1, '2026-03': 2 }));
    assert(f.weighted({ '2025-12': 0, '2026-01': 1 }) === 'January 2026, each counted once', f.weighted({ '2025-12': 0, '2026-01': 1 }));
    return 'runs, gaps and weights read as intended';
  });
}
