// Cost limits on Setup (D6): the most a hire may cost in a location, and the
// most an application may cost in a location on a platform. Loaded by
// index.html as a Babel script before the app; exposed as
// window.RACUI.CostLimits.
//
// The plan stops adding spend to a location or platform where a limit would be
// passed, moves that money to locations still within their limits, and reports
// anything it could not place. Cost per hire limits are by location only: the
// data does not support a cost per hire by platform.
//
// Blank means no limit. Limits are saved with the plan and printed in the PDF
// assumptions and the workings.
(function () {
  const { useState, useEffect } = React;
  const RACUI = (window.RACUI = window.RACUI || {});
  const RAC = window.RAC;

  function MoneyField({ value, onCommit, field, width = 88 }) {
    const fmt = (v) => (v > 0 ? String(Math.round(v)) : '');
    const [text, setText] = useState(fmt(value));
    useEffect(() => { setText(fmt(value)); }, [value]);
    const commit = () => {
      const t = String(text).replace(/[^0-9.]/g, '');
      const v = t === '' || isNaN(Number(t)) ? 0 : Number(t);
      onCommit(v);
      setText(fmt(v));
    };
    return (
      <input className="text-input" style={{ width, flex: 'none' }} data-field={field}
        placeholder="none" value={text}
        onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    );
  }

  // state.limits = { cph: { role: { region: n } }, cpa: { role: { region: { platform: n } } } }
  function CostLimits({ state, update, role, regions, plan, fmt }) {
    const limits = state.limits || {};
    const cph = (limits.cph || {})[role] || {};
    const cpa = (limits.cpa || {})[role] || {};
    const setCph = (region, v) => update({ limits: { ...limits,
      cph: { ...(limits.cph || {}), [role]: { ...cph, [region]: v } } } });
    const setCpa = (region, plat, v) => update({ limits: { ...limits,
      cpa: { ...(limits.cpa || {}), [role]: { ...cpa, [region]: { ...(cpa[region] || {}), [plat]: v } } } } });
    const set = Object.keys(cph).filter(r => cph[r] > 0).length
      + Object.keys(cpa).reduce((a, r) => a + Object.keys(cpa[r] || {}).filter(p => cpa[r][p] > 0).length, 0);
    const v2 = plan && plan.v2;
    const L = RAC.PLATFORM_LABELS;
    // What each location is actually costing in this plan, so a limit can be
    // set against something real.
    const now = {};
    (v2 ? v2.locations : []).forEach(l => {
      now[l.region] = { cph: l.hires > 0 ? l.spend / l.hires : null, cells: {} };
      RAC.PLATFORMS.forEach(p => { const c = l.cells[p]; now[l.region].cells[p] = c.spend > 0 && c.apps > 0 ? c.spend / c.apps : null; });
    });
    const unplaced = v2 && v2.unplaced && v2.unplaced.reasons.some(r => /limit/i.test(r));
    return (
      <div data-panel={'cost-limits-' + role}>
        <div className="help-text" style={{ marginBottom: 10 }}>
          The most a hire may cost in a location, and the most an application may cost on a platform there. Leave a box
          empty for no limit. The plan stops adding spend where a limit would be passed, moves that money to locations
          still within theirs, and shows anything it could not place. Cost per hire is by location only: the data does
          not support a cost per hire by platform. This plan has {set === 0 ? 'no limits set' : set + ' limit' + (set === 1 ? '' : 's') + ' set'}.
          {unplaced && <strong> Some budget could not be placed within these limits; the Plan tab says how much.</strong>}
        </div>
        <table className="alloc-table" style={{ maxWidth: 900 }}>
          <thead>
            <tr>
              <th>Location</th>
              <th className="num">Most a hire may cost</th>
              {RAC.PLATFORMS.map(p => <th key={p} className="num">Most an application may cost: {L[p]}</th>)}
            </tr>
          </thead>
          <tbody>
            {regions.map(region => (
              <tr key={region}>
                <td>
                  {region}
                  {now[region] && now[region].cph && (
                    <div className="help-text" style={{ marginTop: 2 }}>now {fmt.fmtGBP(now[region].cph)} a hire</div>
                  )}
                </td>
                <td className="num">
                  <MoneyField field={'cph-' + role + '-' + region} value={cph[region] || 0} width={96}
                    onCommit={v => setCph(region, v)} />
                </td>
                {RAC.PLATFORMS.map(p => (
                  <td key={p} className="num">
                    <MoneyField field={'cpa-' + role + '-' + region + '-' + p} value={(cpa[region] || {})[p] || 0}
                      onCommit={v => setCpa(region, p, v)} />
                    {now[region] && now[region].cells[p] && (
                      <div className="help-text" style={{ marginTop: 2 }}>now {fmt.fmtGBP(now[region].cells[p])}</div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  RACUI.CostLimits = CostLimits;
})();
