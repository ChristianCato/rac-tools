// The Assumptions tab (B2, view): every value the model uses, where it came
// from, when it was set, what testing gave, and what this plan used. Loaded by
// index.html as a Babel script before the app; exposed as
// window.RACUI.AssumptionsTab.
//
// Values live in assumptions.csv in the repository, not in code. This tab
// shows them; it does not change them. Changing one means editing that file on
// a branch, checking the test link, and merging, so every change has a date and
// an author. The five settings that belong to a plan rather than to the model
// are set on Setup and are marked here.
(function () {
  const RACUI = (window.RACUI = window.RACUI || {});
  const RAC = window.RAC;

  const OFF = 100000;
  const SOURCE_TEXT = {
    'agreed': 'Agreed with you.',
    'tested': 'Set by tools/calibrate.mjs from the data.',
    'agreed, informed by tests': 'An agreed setting for this release, with the tested figure beside it. It moves to the tested figure only once there are enough test months and the figure holds with any one month left out.',
    'agreed, informed by data': 'Agreed with you after measuring it in the data.',
    'blended by open roles': 'The two roles’ values blended by the open roles in OneRAC locations.',
    'default': 'A starting value, awaiting testing.',
  };

  function show(v, unit) {
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (unit === 'month' || typeof v === 'string') return String(v);
    if (unit === 'share') return (v * 100).toFixed(v * 100 % 1 === 0 ? 0 : 2) + '%';
    if (unit === 'gbp') return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (unit === 'gbp_per_day') return '£' + v.toLocaleString('en-GB') + ' a day';
    if (unit === 'miss') return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
    if (v >= OFF) return String(v) + ' (off)';
    return String(v);
  }

  function AssumptionsTab({ plan, role, roles, setRoleView, roleFull }) {
    const v2 = plan && plan.v2;
    if (!v2) return null;
    const A = v2.A;
    const rows = RAC.text.assumptionRows(A, role, v2);
    const bt = RAC.app.state.backtest;
    const stamp = RAC.stamp.of(v2);
    const changed = rows.filter(r => r.plan !== null && r.plan !== undefined && r.plan !== r.value);
    const switchable = rows.filter(r => r.source === RAC.assumptions.AGREED_TESTED && /the switch rule is met/i.test(r.notes || ''));
    return (
      <div data-panel="assumptions">
        <div className="dial-row" style={{ marginBottom: 14 }}>
          <div className="role-switch">
            {roles.map(r => (
              <button key={r} className={r === role ? 'active' : ''} onClick={() => setRoleView(r)}>{r}</button>
            ))}
          </div>
          <span className="help-text">{roleFull[role]} &middot; values that differ by role show this role&rsquo;s</span>
        </div>

        <div className="banner banner-info">
          <div className="banner-icon">i</div>
          <div>
            Every value the model uses is in <strong>assumptions.csv</strong> in the repository, not in the code, so it can be read
            and changed without touching the calculations. Changing one means editing that file on a branch, checking it on the test
            link and merging, so every change carries a date and an author. This tab shows what the plan on screen used.
            {' '}Assumptions file dated {stamp.assumptionsDate || 'unknown'} ({stamp.assumptionsFingerprint || 'no fingerprint'}).
            {bt && bt.tested && <> Tested figures last worked out on {bt.tested}.</>}
            {' '}Every change to it is in{' '}
            <a className="link-inline" target="_blank" rel="noreferrer"
              href="https://github.com/EnhanceMediaRAC/rac-tools/commits/main/assumptions.csv">the file&rsquo;s history</a>;
            {' '}changes to a plan&rsquo;s own settings are on the Changelog screen.
          </div>
        </div>

        {changed.length > 0 && (
          <div className="banner banner-warn" data-panel="assumptions-plan">
            <div className="banner-icon">!</div>
            <div>
              <strong>{changed.length} value{changed.length === 1 ? '' : 's'} set for this plan rather than taken from the file:</strong>{' '}
              {changed.map(r => `${r.name} (${show(r.plan, r.unit)}, file ${show(r.value, r.unit)})`).join('; ')}.
              {' '}These are printed in the PDF assumptions and in the workings.
            </div>
          </div>
        )}

        {switchable.length > 0 && (
          <div className="banner banner-warn" data-panel="assumptions-switch">
            <div className="banner-icon">!</div>
            <div>
              <strong>{switchable.length} agreed value{switchable.length === 1 ? ' has' : 's have'} met the rule for moving to the tested figure.</strong>{' '}
              {switchable.map(r => `${r.name} (using ${show(r.value, r.unit)}, tested ${show(r.tested, r.unit)})`).join('; ')}.
              {' '}Nothing changes until the file is edited.
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head"><div className="card-title">Every value this plan used</div></div>
          <div className="card-body">
            <table className="alloc-table">
              <thead><tr>
                <th>What it is</th>
                <th className="num">Value used</th>
                <th className="num">This plan</th>
                <th className="num">Testing gave</th>
                <th>Where it came from</th>
                <th>Set</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key + '|' + (r.source || '')}>
                    <td>
                      {r.name}
                      <div className="help-text" style={{ marginTop: 2 }}>{r.key}</div>
                    </td>
                    <td className="num mono">{show(r.value, r.unit)}</td>
                    <td className="num mono">{r.plan === null || r.plan === undefined ? '' : show(r.plan, r.unit)}</td>
                    <td className="num mono">{r.tested === null || r.tested === undefined ? '' : show(r.tested, r.unit)}</td>
                    <td>
                      {r.source}
                      <div className="help-text" style={{ marginTop: 2 }}>{SOURCE_TEXT[r.source] || ''}</div>
                    </td>
                    <td className="mono">{r.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Why each one is there</div></div>
          <div className="card-body method-body">
            {rows.filter(r => r.notes).map(r => (
              <p key={'n' + r.key + (r.source || '')}><strong>{r.name}.</strong> {r.notes}</p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  RACUI.AssumptionsTab = AssumptionsTab;
})();
