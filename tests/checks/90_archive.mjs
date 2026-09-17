// Checks for the archive app (addendum 2.9): the read-only copy of the app as
// it was before this release, for the plans made in it. The browser check
// opens it; these confirm it is what it says it is.
import { spawnSync } from 'node:child_process';
import { readRoot, ROOT } from '../lib/planner.mjs';

function python(args) {
  for (const exe of ['python', 'python3']) {
    const r = spawnSync(exe, args, { cwd: ROOT, encoding: 'utf8' });
    if (!r.error) return r;
  }
  return null;
}

export default function (check, { assert }) {
  check('Archive: the frozen copy of the old app is the app as it was at 46aaae2', () => {
    const frozen = readRoot('tests/legacy/index_46aaae2.html');
    const lines = frozen.split('\n').length;
    assert(lines === 9731 || lines === 9732, `${lines} lines; the app at 46aaae2 had 9,731`);
    // Its engine is the one the tests keep frozen.
    const engine = readRoot('tests/legacy/engine_46aaae2.js');
    const marker = 'function buildFundingPlanUncached';
    assert(frozen.includes(marker) && engine.includes(marker), 'the frozen app and the frozen engine disagree');
    assert(!frozen.includes('resetDataCaches'), 'the frozen app should not hold this release’s months fix');
    return `${lines} lines, the previous engine inside it, and none of this release’s changes`;
  });

  check('Archive: archive/index.html is exactly what its build script makes', () => {
    const r = python(['tools/build_archive.py', '--check']);
    if (!r) return 'SKIPPED: Python not found';
    assert(r.status === 0, (r.stdout || '') + (r.stderr || ''));
    return (r.stdout || '').trim().split(/\r?\n/).slice(-1)[0];
  });

  check('Archive: it cannot write, reads only its own copy, and replays the load order', () => {
    const a = readRoot('archive/index.html');
    assert(/const ARCHIVE = true;/.test(a), 'the archive flag is missing');
    assert(/async function sbSet\(key, value\) \{[\s\S]{0,300}?if \(ARCHIVE\) return false;/.test(a), 'the archive can still write');
    ['archive:workspace', 'archive:benchmarks', 'archive:hire_rates'].forEach(k =>
      assert(a.includes(`'${k}'`), 'no archive key ' + k));
    assert(/const k = ARCHIVE && ARCHIVE_KEYS\[key\] \? ARCHIVE_KEYS\[key\] : key;/.test(a), 'reads are not mapped to the archive keys');
    assert(/if \(ARCHIVE\) return \[\];\s+\/\/ nobody is "in" the archive/.test(a), 'presence is still read');
    assert(a.includes('<script src="../planner/legacy_rac_data_46aaae2.js"></script>'), 'the archive does not load the frozen data file');
    assert(!/<script src="rac_data\.js"><\/script>/.test(a), 'the archive still loads the live data file');
    assert(/dataMonths\(\);[\s\S]{0,80}const root = ReactDOM\.createRoot/.test(a), 'the month list is not worked out before the first render');
    assert(a.includes('Archive: pre-release plans, read-only'), 'the banner is missing');
    assert(!a.includes('resetDataCaches'), 'the archive should not hold the months fix: it would change the figures');
    return 'never writes, reads archive:workspace, archive:benchmarks and archive:hire_rates, loads the 46aaae2 data file, ' +
      'works out its months before the first render, and shows the banner';
  });

  check('Archive: the release keeps a copy of the plans and data before it writes anything', () => {
    const html = readRoot('index.html');
    assert(/const ARCHIVE_COPY = \{ workspace: 'archive:workspace'/.test(html), 'no archive copy keys in the app');
    const fn = html.match(/async function copyForArchive\(\) \{[\s\S]*?\n\}/);
    assert(fn, 'copyForArchive is missing');
    assert(/if \(!CAN_SAVE\) return/.test(fn[0]), 'a test link would take the copy');
    assert(/const already = await sbGet\(ARCHIVE_COPY\.workspace\);[\s\S]{0,120}?if \(already\) return/.test(fn[0]),
      'the copy would be taken again over an existing one');
    // It runs on the first pull, before the workspace read the app plans from.
    const pull = html.match(/const pull = React\.useCallback\(async \(\) => \{[\s\S]*?const remote = await sbGet\('workspace'\);/);
    assert(pull && /copyForArchive\(\)/.test(pull[0]), 'the copy is not taken before the app reads the workspace');
    return 'taken once, on the live address only, before the first workspace read, and never over an existing copy';
  });
}
