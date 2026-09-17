// Benchmarks tab, on the planner's own figures (RAC.cost and RAC.rates), so
// every cost per application shown here is the one the plan starts from.
// Loaded by index.html as a Babel script before the app; exposed as
// window.RACUI.BenchmarksTab. Formatting helpers are passed in by the app.
(function () {
  const { useState } = React;
  const P = () => window.RAC.PLATFORMS;
  const LABEL = { indeed: 'Indeed', meta: 'Meta', google: 'Google', appcast: 'Appcast' };
  const pct = (x, dp = 1) => (x === null || x === undefined || !isFinite(x) ? '-' : (x * 100).toFixed(dp) + '%');

  function quality(months, apps) {
    if (months >= 6 && apps >= 60) return { label: 'Strong', kind: 'good' };
    if (months >= 3 && apps >= 20) return { label: 'Usable', kind: 'warn' };
    if (apps >= 1) return { label: 'Thin', kind: 'bad' };
    return { label: 'None', kind: 'none' };
  }

  function BenchmarksTab({ state, setState, role, setRole, dataVersion, fmt }) {
    const RAC = window.RAC;
    const { fmtGBP, fmtInt, monthShort } = fmt;
    const [open, setOpen] = useState({ byLocation: true, byPlatform: true, months: false });
    const [openPlat, setOpenPlat] = useState({});
    let env;
    try { env = RAC.app.env(window.__AVP_DATA__, dataVersion); }
    catch (e) { return <div className="banner banner-warn"><div className="banner-icon">!</div><div>{e.message}</div></div>; }
    const { ds, A, eploy } = env;
    const bench = (state.bench && state.bench[role]) || null;
    const w = RAC.cost.normWindow(bench);
    const mode = w.mode || 'all';
    const ctx = RAC.cost.context(ds, A, role, bench);
    const rates = RAC.rates.build(eploy, A, role, { regions: ds.regions });
    const bias = RAC.assumptions.get(A, 'remaining_error_factor', role);
    // Hires scaled as the plan scales them: reconciled to the hires Eploy
    // credited to the platforms, plus the plan's share of other-source hires.
    const s = state.otherHiresShare && state.otherHiresShare[role];
    const share = s != null && s >= 0 && s <= 1 ? s : RAC.assumptions.get(A, 'other_hires_credited_share', role);
    const recon = RAC.assumptions.get(A, 'paid_hire_reconciliation_factor', role)
      + share * RAC.assumptions.get(A, 'other_hires_credit_factor', role);
    const months = ctx.settled;
    const setBench = (b) => setState(st => ({ ...st, bench: { ...(st.bench || {}), [role]: b } }));
    const from = w.from || months[0];
    const to = w.to || months[months.length - 1];
    const excluded = ds.months.filter(mo => !ctx.status[mo].settled);

    // Everything below is on the window's settled months.
    const cell = (plat, region) => {
      const s = RAC.cost.windowStats(ctx, plat, region);
      const u = RAC.cost.usualCpa(ctx, plat, region);
      const r = RAC.rates.cell(rates, plat, region);
      const hpa = r.hirePerApplication * recon;
      const cpa = u.cpa * bias;
      return { plat, region, s, u, r, hpa, cpaPlanned: cpa, cph: hpa > 0 ? cpa / hpa : null,
        q: quality(s.months.filter(mo => RAC.data.monthly(ds, plat, region, role)[mo].apps >= 1).length, s.apps) };
    };
    const grid = ds.regions.map(region => ({ region, cells: P().map(p => cell(p, region)) }));
    const all = grid.flatMap(g => g.cells);
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    const spendAll = sum(all.map(c => c.s.spend)), appsAll = sum(all.map(c => c.s.apps));
    const counts = { good: 0, warn: 0, bad: 0, none: 0 };
    all.forEach(c => { counts[c.q.kind] += 1; });

    // A row's usual cost per application, weighted by where spend went in the window.
    const blend = (cells) => {
      const withSpend = cells.filter(c => c.s.spend > 0);
      const spend = sum(withSpend.map(c => c.s.spend));
      const apps = sum(withSpend.map(c => c.s.spend / c.u.cpa));
      const hires = sum(withSpend.map(c => (c.s.spend / c.cpaPlanned) * c.hpa));
      return { cpa: apps > 0 ? spend / apps : null, cph: hires > 0 ? spend / hires : null };
    };

    const Section = ({ id, title, sub, children }) => (
      <div className="card">
        <div className="card-head fold-head" onClick={() => setOpen(o => ({ ...o, [id]: !o[id] }))}>
          <span className={'fold-chev' + (open[id] ? ' open' : '')}>{'›'}</span>
          <div><div className="card-title">{title}</div><div className="card-sub">{sub}</div></div>
        </div>
        {open[id] && <div className="card-body" style={{ padding: 0 }}>{children}</div>}
      </div>
    );
    const windowText = RAC.cost.normWindow(bench).mode === 'last3up'
      ? `every settled month this year, the last three counting ${w.mult || 3} times as much`
      : ({ all: 'every settled month, counting the same', ytd: 'settled months this year, counting the same',
        last3: 'the last three settled months only', custom: 'the settled months you have chosen' })[mode];
    const rangeLabel = `${ctx.windowMonths.length} month${ctx.windowMonths.length === 1 ? '' : 's'}` +
      (ctx.windowMonths.length ? `, ${monthShort(ctx.windowMonths[0])} to ${monthShort(ctx.windowMonths[ctx.windowMonths.length - 1])}` : '');

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="role-switch role-switch-lead">
            {RAC.ROLES.map(r => <button key={r} className={r === role ? 'active' : ''} onClick={() => setRole(r)}>{r}</button>)}
          </div>
          <div className="role-switch">
            {[['all', 'All time'], ['ytd', 'Year to date'], ['last3', 'Last 3 months'],
              ['last3up', 'Year to date, recent weighted'], ['custom', 'Custom range']].map(([id, label]) => (
              <button key={id} className={mode === id ? 'active' : ''}
                onClick={() => setBench(id === 'all' ? null
                  : id === 'custom' ? { mode: 'custom', from, to }
                  : id === 'last3up' ? { mode: 'last3up', mult: w.mult || 3 }
                  : { mode: id })}>{label}</button>
            ))}
          </div>
          {mode === 'last3up' && (
            <div className="mb-group">
              <label>Last 3 months count</label>
              <select value={w.mult || 3} onChange={e => setBench({ mode: 'last3up', mult: Number(e.target.value) })}>
                {[1, 1.5, 2, 3, 4, 5, 6, 8, 10].map(x => <option key={x} value={x}>{x}x</option>)}
              </select>
            </div>
          )}
          {mode === 'custom' && (
            <div className="mb-group">
              <label>From</label>
              <select value={from} onChange={e => setBench({ mode: 'custom', from: e.target.value > to ? to : e.target.value, to })}>
                {months.map(m => <option key={m} value={m}>{monthShort(m)}</option>)}
              </select>
              <label>to</label>
              <select value={to} onChange={e => setBench({ mode: 'custom', from, to: e.target.value < from ? from : e.target.value })}>
                {months.map(m => <option key={m} value={m}>{monthShort(m)}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="banner banner-info">
          <div className="banner-icon">i</div>
          <div>
            The plan uses {windowText}: {rangeLabel}.
            {excluded.length > 0 && <> Not yet counted: {excluded.map(mo => monthShort(mo) + ' (' + ctx.status[mo].reason + ')').join('; ')}.</>}
            {' '}Cost per application is the usual figure the plan starts from, before it is adjusted for the planned
            spend level. Cost per hire is at the usual spend, after the remaining-error adjustment
            (x{bias.toFixed(3)}) and the reconciliation to the hires RAC recorded against the four platforms, including
            the {Math.round(share * 100)}% of other-source hires credited to paid media (x{recon.toFixed(3)}). Screening and hire rates came
            from {eploy.dataset.file} ({eploy.dataset.file_date}), applications {rates.screenMonths[0]} to {rates.screenMonths[rates.screenMonths.length - 1]}.
          </div>
        </div>

        <div className="kpi-row" style={{ marginBottom: 18 }}>
          <div className="kpi kpi-accent-blue">
            <div className="kpi-label">Cost per application</div>
            <div className="kpi-value mono">{appsAll > 0 ? fmtGBP(spendAll / appsAll) : '-'}</div>
            <div className="kpi-sub">{fmtInt(appsAll)} applications on {fmtGBP(spendAll)}, before thin-data adjustment</div>
          </div>
          <div className="kpi kpi-accent-good"><div className="kpi-label">Strong coverage</div><div className="kpi-value mono">{counts.good}</div><div className="kpi-sub">of {all.length} location and platform cells</div></div>
          <div className="kpi kpi-accent-orange"><div className="kpi-label">Usable</div><div className="kpi-value mono">{counts.warn}</div><div className="kpi-sub">enough to plan against</div></div>
          <div className="kpi kpi-accent-navy"><div className="kpi-label">Thin or none</div><div className="kpi-value mono">{counts.bad + counts.none}</div><div className="kpi-sub">{counts.bad} thin, {counts.none} with nothing</div></div>
        </div>

        <Section id="byLocation" title="By location, across all platforms" sub={rangeLabel + '. Blended by where spend went in the window.'}>
          <table className="alloc-table">
            <thead><tr>
              <th>Location</th><th>Cost per application</th><th>Cost per hire</th><th>Screening pass rate</th>
              <th>Hire rate after screening</th><th>Applications</th><th>Spend</th>
            </tr></thead>
            <tbody>
              {grid.map(({ region, cells }) => {
                const b = blend(cells);
                const loc = rates.location[region];
                return (
                  <tr key={region}>
                    <td>{region}</td>
                    <td className="mono">{b.cpa ? fmtGBP(b.cpa) : '-'}</td>
                    <td className="mono">{b.cph ? fmtGBP(b.cph) : '-'}</td>
                    <td className="mono">{loc ? pct(loc.ownScreen) + ' (adjustment x' + loc.screenAdjustment.toFixed(2) + ')' : '-'}</td>
                    <td className="mono">{loc ? pct(loc.hireAfterScreening) : '-'}</td>
                    <td className="mono">{fmtInt(sum(cells.map(c => c.s.apps)))}</td>
                    <td className="mono">{fmtGBP(sum(cells.map(c => c.s.spend)))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        <Section id="byPlatform" title="By platform, across all locations" sub={rangeLabel + '. Cost per application is the platform figure every location is pulled towards.'}>
          <table className="alloc-table">
            <thead><tr>
              <th>Platform</th><th>Cost per application</th><th>Screening pass rate used</th><th>Basis</th>
              <th>Locations with data</th><th>Applications</th><th>Spend</th>
            </tr></thead>
            <tbody>
              {P().map(p => {
                const cs = all.filter(c => c.plat === p);
                const pf = RAC.cost.platformCpa(ctx, p);
                return (
                  <tr key={p}>
                    <td>{LABEL[p]}</td>
                    <td className="mono">{fmtGBP(pf.cpa)}</td>
                    <td className="mono">{pct(rates.platform[p].used)}</td>
                    <td>{rates.platform[p].basis}</td>
                    <td className="mono">{cs.filter(c => c.s.apps >= 1).length} of {ds.regions.length}</td>
                    <td className="mono">{fmtInt(sum(cs.map(c => c.s.apps)))}</td>
                    <td className="mono">{fmtGBP(sum(cs.map(c => c.s.spend)))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        {P().map(p => {
          const rows = grid.map(g => g.cells.find(c => c.plat === p));
          const isOpen = !!openPlat[p];
          return (
            <div className="card" key={p}>
              <div className="card-head fold-head" onClick={() => setOpenPlat(o => ({ ...o, [p]: !o[p] }))}>
                <span className={'fold-chev' + (isOpen ? ' open' : '')}>{'›'}</span>
                <div>
                  <div className="card-title">{LABEL[p]} by location</div>
                  <div className="card-sub">{fmtInt(sum(rows.map(c => c.s.apps)))} applications on {fmtGBP(sum(rows.map(c => c.s.spend)))} &middot; {rangeLabel}</div>
                </div>
              </div>
              {isOpen && (
                <div className="card-body" style={{ padding: 0 }}>
                  <table className="alloc-table">
                    <thead><tr>
                      <th>Location</th><th>Own cost per application</th><th>Cost per application used</th><th>Cost per hire</th>
                      <th>Hires per application</th><th>Apply rate</th><th>Months</th><th>Applications</th><th>Spend</th><th>Data quality</th>
                    </tr></thead>
                    <tbody>
                      {rows.map(c => (
                        <tr key={c.region}>
                          <td>{c.region}</td>
                          <td className="mono">{c.u.rawCpa ? fmtGBP(c.u.rawCpa) : '-'}</td>
                          <td className="mono">{fmtGBP(c.u.cpa)}{c.u.source !== 'own' ? ' (platform figure)' : ''}</td>
                          <td className="mono">{c.cph ? fmtGBP(c.cph) : '-'}</td>
                          <td className="mono">{pct(c.hpa, 2)}</td>
                          <td className="mono">{c.s.clicks > 0 ? pct(c.s.apps / c.s.clicks, 2) : '-'}</td>
                          <td>{c.s.months.length ? c.s.months.length + ', ' + monthShort(c.s.months[0]) + ' to ' + monthShort(c.s.months[c.s.months.length - 1]) : '-'}</td>
                          <td className="mono">{fmtInt(c.s.apps)}</td>
                          <td className="mono">{fmtGBP(c.s.spend)}</td>
                          <td><span className={'pill pill-' + (c.q.kind === 'none' ? '' : c.q.kind)}>{c.q.label}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  window.RACUI = window.RACUI || {};
  window.RACUI.BenchmarksTab = BenchmarksTab;
})();
