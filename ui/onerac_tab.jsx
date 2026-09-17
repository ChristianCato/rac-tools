// The OneRAC tab: its set-up and its plan (D7). Loaded by index.html as a
// Babel script before the app; exposed as window.RACUI.OneRacTab.
//
// OneRAC runs one set of campaigns for both roles in its locations, from the
// month each location launches. Those locations come out of the SMR and Patrol
// plans, and the OneRAC budget comes off both role budgets unless that is
// switched off. The plan itself is planner/onerac.js.
(function () {
  const { useState, useEffect } = React;
  const RACUI = (window.RACUI = window.RACUI || {});
  const RAC = window.RAC;

  function NumberField({ value, onCommit, format, parse, width = 110, field }) {
    const [text, setText] = useState(format(value));
    useEffect(() => { setText(format(value)); }, [value]);
    const commit = () => {
      const v = parse(text);
      onCommit(v);
      setText(format(v === null ? value : v));
    };
    return (
      <input className="text-input" style={{ width, flex: 'none' }} data-field={field}
        value={text} onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    );
  }

  const num = (s) => {
    const t = String(s).replace(/[^0-9.]/g, '');
    return t === '' || isNaN(Number(t)) ? null : Number(t);
  };

  function Row({ label, children, note }) {
    return (
      <div className="dial-row" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
        <label className="field-label" style={{ flex: 'none', width: 250, paddingTop: 6 }}>{label}</label>
        {children}
        <span className="help-text" style={{ flex: 1, paddingTop: 4 }}>{note}</span>
      </div>
    );
  }

  // The set-up: which locations, from when, the budget, and how it is funded.
  function Setup({ state, update, fmt, suggestion, months, regions }) {
    const one = state.oneRac || {};
    const locations = one.locations || [];
    const set = (patch) => update({ oneRac: { ...one, ...patch } });
    const setLocation = (region, patch) => {
      const rest = locations.filter(l => l.region !== region);
      const mine = locations.find(l => l.region === region) || { region, from: state.planMonth };
      const next = patch === null ? rest : rest.concat([{ ...mine, ...patch }]);
      set({ locations: next.sort((a, b) => (a.region < b.region ? -1 : 1)) });
    };
    let selfDefault = 0;
    try { selfDefault = RAC.assumptions.get(RAC.app.state.A, 'onerac_self_competition'); } catch (e) { selfDefault = 0; }
    return (
      <div className="card" data-panel="onerac-setup">
        <div className="card-title">OneRAC set-up</div>
        <div className="help-text" style={{ marginBottom: 12 }}>
          Pick the locations OneRAC runs in and the month each one starts. From that month they are planned here and
          left out of the SMR and Patrol plans, so nothing is planned twice.
        </div>
        <table className="alloc-table" style={{ maxWidth: 620, marginBottom: 16 }}>
          <thead><tr><th>Location</th><th>On OneRAC</th><th>First month</th><th className="num">Open roles (SMR + Patrol)</th></tr></thead>
          <tbody>
            {regions.map(region => {
              const mine = locations.find(l => l.region === region);
              const v = (role) => Math.max(0, Math.round(((state.vacancies || {})[role] || {})[region] || 0));
              return (
                <tr key={region}>
                  <td>{region}</td>
                  <td>
                    <input type="checkbox" data-field={'onerac-on-' + region} checked={!!mine}
                      onChange={e => setLocation(region, e.target.checked ? {} : null)} />
                  </td>
                  <td>
                    {mine ? (
                      <select className="text-input" style={{ width: 130 }} data-field={'onerac-from-' + region}
                        value={mine.from || state.planMonth}
                        onChange={e => setLocation(region, { from: e.target.value })}>
                        {months.map(mo => <option key={mo} value={mo}>{fmt.monthLabel(mo)}</option>)}
                      </select>
                    ) : <span className="help-text">-</span>}
                  </td>
                  <td className="num mono">{v('SMR') + v('Patrol')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Row label="OneRAC budget this month"
          note={<>What OneRAC has to spend. The SMR and Patrol plans would have put about {fmt.fmtGBP(suggestion)} into
            these locations this month, which is a starting point, not a recommendation.</>}>
          <NumberField field="onerac-budget" value={one.budget || 0}
            format={v => fmt.fmtGBP(v || 0)} parse={t => num(t) || 0}
            onCommit={v => set({ budget: v })} />
        </Row>
        <Row label="Hire target"
          note="Used the same way as a role plan's target: the plan reports the budget that reaches it, or the most hires it can deliver within the spending caps.">
          <NumberField field="onerac-hire-target" value={one.hireTarget || 0}
            format={v => String(Math.round(v || 0))} parse={t => num(t) || 0}
            onCommit={v => set({ hireTarget: v })} />
        </Row>
        <Row label="Fund OneRAC from the SMR and Patrol budgets"
          note={<>On by default. The OneRAC budget comes off both role budgets, split by the open roles in OneRAC
            locations, and each role plan shows it as a OneRAC hold-back. Off, the role budgets are untouched and the
            OneRAC budget is a separate decision.</>}>
          <input type="checkbox" data-field="onerac-fund" style={{ marginTop: 8, flex: 'none', width: 110 }}
            checked={one.fundFromRoles !== false}
            onChange={e => set({ fundFromRoles: e.target.checked })} />
        </Row>
        <Row label="Self-competition improvement"
          note={<>How much cheaper an application is expected to be once SMR and Patrol stop bidding against each other
            in these locations. Default {Math.round(selfDefault * 100)}%, because it has not been measured yet. After four to six
            weeks we will compare these locations with their own history and with similar locations not on OneRAC, and
            replace it with the measured result.</>}>
          <NumberField field="onerac-self-competition" value={one.selfCompetition != null ? one.selfCompetition : selfDefault}
            format={v => Math.round(v * 100) + '%'}
            parse={t => { const n = num(t); return n === null ? null : Math.min(90, Math.max(0, n)) / 100; }}
            onCommit={v => set({ selfCompetition: v })} />
        </Row>
        <Row label="Indeed Premium campaigns"
          note="Campaigns x days in the month x the Indeed Premium day rate comes off the OneRAC budget, as in a role plan.">
          <NumberField field="onerac-premium" value={one.premiumCampaigns || 0}
            format={v => String(Math.round(v || 0))} parse={t => num(t) || 0}
            onCommit={v => set({ premiumCampaigns: v })} />
        </Row>
        <Row label="Combined Activity reserve" note="Held back before the locations are funded, as in a role plan.">
          <NumberField field="onerac-ac" value={one.acReserve || 0}
            format={v => fmt.fmtGBP(v || 0)} parse={t => num(t) || 0}
            onCommit={v => set({ acReserve: v })} />
        </Row>
      </div>
    );
  }

  // The plan itself.
  function PlanView({ plan, fmt }) {
    const { fmtGBP, fmtInt } = fmt;
    const t = plan.totals;
    const r = t.range || {};
    const L = RAC.PLATFORM_LABELS;
    const ca = RAC.text.costAdjustment(plan);
    const o = plan.oneRac;
    return (
      <div data-panel="onerac-plan">
        <div className="kpi-row" style={{ marginBottom: 18 }}>
          <div className="kpi kpi-accent-blue">
            <div className="kpi-label">Predicted applications</div>
            <div className="kpi-value mono">{fmtInt(t.apps)}</div>
            <div className="kpi-sub">{r.apps ? `${fmtInt(r.apps.low)} to ${fmtInt(r.apps.high)}` : ''}</div>
          </div>
          <div className="kpi kpi-accent-good">
            <div className="kpi-label">Predicted hires</div>
            <div className="kpi-value mono">{t.allHires.toFixed(1)}</div>
            <div className="kpi-sub">{t.hires.toFixed(1)} from paid media, {t.otherHires.toFixed(1)} from other sources</div>
          </div>
          <div className="kpi kpi-accent-orange">
            <div className="kpi-label">Cost per hire</div>
            <div className="kpi-value mono">{t.hires > 0 ? fmtGBP(t.spend / t.hires) : '-'}</div>
            <div className="kpi-sub">on paid-media hires</div>
          </div>
          <div className="kpi kpi-accent-navy">
            <div className="kpi-label">{plan.unreachable ? 'Most hires' : 'Budget for the target'}</div>
            <div className="kpi-value mono">{plan.unreachable ? plan.maxAchievable.toFixed(1) : fmtGBP(plan.budgetForTarget)}</div>
            <div className="kpi-sub">{plan.unreachable ? `reached at ${fmtGBP(plan.saturationBudget)}` : `for ${plan.hireTarget} hires`}</div>
          </div>
        </div>

        <div className="banner banner-info" style={{ marginBottom: 18 }}>
          <div className="banner-icon">i</div>
          <div>
            OneRAC in {o.regions.join(', ')}: {o.mix.total} open roles
            ({window.RAC.ROLES.map(role => `${role} ${o.mix.vacancies[role]}`).join(', ')}).
            Past performance is the two roles&rsquo; spend and applications in these locations added together.
            Cost per application is blended to the mix of open roles
            {o.adjustment.openBlend ? <> ({fmtGBP(o.adjustment.openBlend)} against {fmtGBP(o.adjustment.combined)} blended by past
              spend, x{o.adjustment.factor.toFixed(3)})</> : null}
            {ca.selfCompetition > 0 ? <>, then reduced by the self-competition assumption of {Math.round(ca.selfCompetition * 100)}%</> : null}.
            {' '}{ca.label} in use: {ca.used.toFixed(3)} ({ca.basis}).
          </div>
        </div>

        <table className="alloc-table" style={{ marginBottom: 18 }}>
          <thead><tr>
            <th>Location</th><th className="num">Open roles</th><th className="num">Spend</th>
            <th className="num">Applications</th><th className="num">Quality applications</th>
            <th className="num">Hires (paid media)</th><th className="num">Cost per application</th><th className="num">Cost per hire</th>
          </tr></thead>
          <tbody>
            {plan.locations.map(l => (
              <tr key={l.region}>
                <td>{l.region}</td>
                <td className="num mono">{l.vacancies}</td>
                <td className="num mono">{fmtGBP(l.spend)}</td>
                <td className="num mono">{fmtInt(l.apps)}</td>
                <td className="num mono">{fmtInt(l.passed)}</td>
                <td className="num mono">{l.hires.toFixed(1)}</td>
                <td className="num mono">{l.apps > 0 ? fmtGBP(l.spend / l.apps) : '-'}</td>
                <td className="num mono">{l.spend > 0 && l.hires > 0 ? fmtGBP(l.spend / l.hires) : '-'}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600 }}>
              <td>Total</td>
              <td className="num mono">{plan.totalVac}</td>
              <td className="num mono">{fmtGBP(t.spend)}</td>
              <td className="num mono">{fmtInt(t.apps)}</td>
              <td className="num mono">{fmtInt(t.passed)}</td>
              <td className="num mono">{t.hires.toFixed(1)}</td>
              <td className="num mono">{t.apps > 0 ? fmtGBP(t.spend / t.apps) : '-'}</td>
              <td className="num mono">{t.hires > 0 ? fmtGBP(t.spend / t.hires) : '-'}</td>
            </tr>
          </tbody>
        </table>

        <table className="alloc-table" style={{ maxWidth: 900 }}>
          <thead><tr>
            <th>Platform</th><th className="num">Spend</th><th className="num">Media</th><th className="num">Platform fee</th>
            <th className="num">Applications</th><th className="num">Hires</th><th className="num">Cost per application</th>
          </tr></thead>
          <tbody>
            {RAC.PLATFORMS.map(p => {
              const x = plan.platforms[p];
              return (
                <tr key={p}>
                  <td>{L[p]}</td>
                  <td className="num mono">{fmtGBP(x.spend)}</td>
                  <td className="num mono">{fmtGBP(x.media)}</td>
                  <td className="num mono">{plan.fees.on && plan.fees.rates[p] > 0 ? fmtGBP(x.fee) : '-'}</td>
                  <td className="num mono">{fmtInt(x.apps)}</td>
                  <td className="num mono">{x.hires.toFixed(1)}</td>
                  <td className="num mono">{x.apps > 0 ? fmtGBP(x.spend / x.apps) : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {plan.unplaced.total > 0.5 && (
          <div className="help-text" style={{ marginTop: 12 }}>
            {fmtGBP(plan.unplaced.total)} could not be placed efficiently{plan.unplaced.reasons.length ? ': ' + plan.unplaced.reasons.join('; ') : ''}.
          </div>
        )}
        {plan.minimumShortfalls.map((x, i) => <div className="help-text" key={i} style={{ marginTop: 6 }}>{x.text}.</div>)}
      </div>
    );
  }

  function OneRacTab({ state, update, fmt, months, regions, suggestion, plan, onExportPdf, onExportWorkings }) {
    return (
      <div>
        <Setup state={state} update={update} fmt={fmt} suggestion={suggestion} months={months} regions={regions} />
        {plan ? (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>The OneRAC plan</span>
              <span>
                <button className="btn btn-sm" style={{ marginRight: 8 }} onClick={onExportWorkings}>Workings</button>
                <button className="btn btn-sm btn-primary" onClick={onExportPdf}>PDF</button>
              </span>
            </div>
            <PlanView plan={plan} fmt={fmt} />
          </div>
        ) : (
          <div className="banner banner-info" style={{ marginTop: 18 }} data-panel="onerac-none">
            <div className="banner-icon">i</div>
            <div>No OneRAC locations have started this month, so there is no OneRAC plan. Tick a location above and set
              the month it starts.</div>
          </div>
        )}
      </div>
    );
  }

  RACUI.OneRacTab = OneRacTab;
})();
