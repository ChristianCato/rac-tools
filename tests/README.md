# Automatic checks

These checks confirm the planning engine still does what it should after any
change. Run them before a branch is merged to main.

## Running them

From the repo folder:

    node tests/run.mjs

Needs Node 18 or later and nothing else. Every line reads PASS, FAIL or SKIP,
and the run ends with separate counts of passed, skipped and failed checks.
Any FAIL means the change is not ready. A SKIP is not a pass: it names what is
missing.

Checks for the new planner live in `checks/`, one file per area, and are
picked up automatically. `lib/planner.mjs` loads the planner files listed in
`planner/manifest.json`, the same list the app loads, so no code is cut out of
index.html for them.

The browser checks are separate, because they need a browser:

    python tests/browser/save_guard.py
    python tests/browser/app_checks.py
    python tests/browser/export_checks.py
    python tests/browser/issued_checks.py
    python tests/browser/archive_checks.py

Both use `browser/guard.py`, which answers or blocks every request the page
makes (see below).

Needs Python 3 and Playwright (`pip install playwright`, then
`playwright install chromium`). The script's opening comment explains the
`--libs` option for machines without internet access. `export_checks.py` also
needs pypdf and openpyxl, and LibreOffice for the workings part; without
LibreOffice or openpyxl it says so and reports that part as skipped.

## What each check covers

| Check | What it proves |
|---|---|
| Frozen engine rebuilds September SMR plan 2a | The engine as it was on 14 September, fed plan 2a's data and settings, gives the plan sent to RAC on 28 August: applications, hires, range, spend above ceiling, and every location and platform row. |
| Frozen engine rebuilds the saved plan as held on 16 September | Replays how the live app loaded that day and matches the live workings export. It also records that the plan and its workings disagreed on Meta rows that day, and why. |
| Frozen engine shows the fault | A month added after the app opened got no weight. Kept so the diagnosis stays on record. |
| Current engine: a month added after opening is weighted | The fix: after August is added, the window moves to June to August and the plan matches a clean load of the same data. |
| Only rac-tools.vercel.app can write to the database | The save function returns before writing on any other address, and nothing else writes to the database. |
| September Patrol plan rebuild | Skipped until a Patrol workings export is available. |
| Planner checks (`checks/`) | Assumptions file, Eploy import, part months and cost per application, hire rates and forecast, testing on past months and tested values, spending caps and allocation, platform fees, the connection to the app (including pacing for plans made before the release), and what RAC sees: the Method and glossary text, the version stamp and the output checks (no em-dashes, no Hiring Lab, no location application targets, no cost per hire on £0 rows, title names the hire target). Each check's note says what it compared. |
| Browser: app_checks.py | In a real browser at the test link address: the Plan tab equals the planner, changing Patrol's window on Benchmarks leaves SMR unchanged, both header role buttons switch the role, every core Setup field (cap multiple, credited share, expected hires from other sources, remaining-error adjustment, include months still settling) reaches the plan, a month still settling is flagged, the out-of-reach panel shows the planner's figures at cap multiples 1 to 3, Use those counts instead sets that role's open roles to RAC's plan column without a page error, a broken assumptions.csv stops the app naming the row, and nothing is written. |
| Pacing for saved September plans | Runs when `RAC_PACING_DIR` points at the folder holding `LIVE_pacing_<name>.xlsx` and `TEST_pacing_<name>.xlsx` (Performance Pacing exports of the same saved plan from the live app and the test link); skipped otherwise. Each pair goes through `python tools/compare_pacing.py`, which compares every plan spend and plan applications figure and the plan name. Exports hold RAC spend figures, so they stay in the data folder. |
| Browser: OneRAC | In the browser, with London on OneRAC from this month: the OneRAC tab shows the planner's own figures for its plan, London is out of the SMR plan, and the OneRAC hold-back on the SMR budget is the open-roles share of the OneRAC budget. |
| Browser: export_checks.py | In a real browser at the test link address: the PDF button saves a document whose text (read with pypdf) holds the planner's figures, the title with the hire target and the version stamp on every page; "PDF, no notes" drops only the notes page; and the Workings button saves a workbook that carries no saved answers, so LibreOffice works out all of its formulas from scratch, and every one of them then gives the planner's own figure. |
| Browser: issued_checks.py | On the live address, because issuing writes: "Mark as issued" stores a snapshot under its own key once, a second attempt writes nothing, opening the plan again shows the stored figures even after the data behind them changed (861 applications as issued against 1,354 from a fresh calculation), Rename and Delete are not offered, and editing drops back to the working plan without touching the stored copy. |
| Trace guide and release steps | docs/trace_guide.md follows South East Indeed from the monthly rows to its hires; a check rebuilds the same plan and confirms all 20 figures it quotes are still the planner's, so the guide cannot go quietly out of date. docs/release.md is checked for every command to run, the back-up, the archive copy and the match against the live exports. |
| Record of changes | Part of issued_checks.py: changing a plan setting writes one record, on its own key, with who, when, what it was and what it became, and the Changelog screen shows it. |
| Browser: archive_checks.py | The archive app at /archive/: it opens, shows the read-only banner, reads only archive:workspace, archive:benchmarks and archive:hire_rates, never writes even when a setting is changed, and gives the same figures when the database answers three seconds late as when it answers at once. That last one is the point of the archive: the live app's figures depended on the month list being worked out before the answer arrived, and the archive replays that deliberately. |
| Archive: built, not edited | archive/index.html is what tools/build_archive.py makes from tests/legacy/index_46aaae2.html, the app exactly as it was at commit 46aaae2. The checks confirm the frozen copy is that app, that the archive cannot write, that its reads are mapped to its own keys, and that this release takes the copy once before it writes anything. |
| Browser: save_guard.py | In a real browser, the live address saves and a test link reads but never writes, shows the test version banner and shows Not saved. |
| Browser: network guard | Every request the page makes is either handled by the check or blocked, so no browser check can reach a real server other than the listed library files. Probe requests confirm the block works; any other blocked request fails the check. |

## Folders

- `legacy/engine_46aaae2.js`: the engine extracted from index.html at GitHub commit 46aaae2. Never edit it.
- `fixtures/`: `rac_data_46aaae2.json.gz` is the repo data file at that commit (the app keeps the same file as `planner/legacy_rac_data_46aaae2.js` for pacing September plans). Since 17 September 2026 `rac_data.js` holds the live app's data to August 2026, and the tests on past months run on it (`lib/calibration_data.mjs`). assumptions.csv keeps each tested figure in its `tested` column; for this release most model settings are agreed values (source "agreed, informed by tests") and `tools/calibrate.mjs --write` updates only their tested figures and notes. The two `smr_sept_*.json` files hold the raw monthly rows and the per-row results from the plan 2a and 16 September workings exports.
- `tools/build_fixture_from_workings.py`: rebuilds a fixture from a workings export.
- `lib/`: the code that extracts the engine and loads fixtures.

## Data kept here

Fixtures hold only monthly spend, applications and clicks by location and
platform, the same kind of figures already in rac_data.js. Candidate-level data,
including the Eploy application report, is never committed. The tests folder is
excluded from Vercel deployments by `.vercelignore`, so none of it is published.

## Adding a fixture

1. Export the workings from the app.
2. If the Workings sheet shows no values (a file straight from the app can hold formulas only), open and save it in Excel first.
3. Run `python3 tests/tools/build_fixture_from_workings.py "Workings.xlsx" tests/fixtures/NAME.json SMR` (or `Patrol`).
4. Add a check in `run.mjs` with the settings that plan used.
