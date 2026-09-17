# Automatic checks

These checks confirm the planning engine still does what it should after any
change. Run them before a branch is merged to main.

## Running them

From the repo folder:

    node tests/run.mjs

Needs Node 18 or later and nothing else. Every line reads PASS, FAIL or SKIP,
and the run ends with a count. Any FAIL means the change is not ready.

The browser check is separate, because it needs a browser:

    python3 tests/browser/save_guard.py

Needs Python 3 and Playwright (`pip install playwright`, then
`playwright install chromium`). The script's opening comment explains the
`--libs` option for machines without internet access.

## What each check covers

| Check | What it proves |
|---|---|
| Frozen engine rebuilds September SMR plan 2a | The engine as it was on 14 September, fed plan 2a's data and settings, gives the plan sent to RAC on 28 August: applications, hires, range, spend above ceiling, and every location and platform row. |
| Current engine rebuilds September SMR plan 2a | The same, on the engine in index.html. Stage 2 replaces the forecast, and this check is retired then; the frozen check stays. |
| Frozen engine rebuilds the saved plan as held on 16 September | Replays how the live app loaded that day and matches the live workings export. It also records that the plan and its workings disagreed on Meta rows that day, and why. |
| Frozen engine shows the fault | A month added after the app opened got no weight. Kept so the diagnosis stays on record. |
| Current engine: a month added after opening is weighted | The fix: after August is added, the window moves to June to August and the plan matches a clean load of the same data. |
| Only rac-tools.vercel.app can write to the database | The save function returns before writing on any other address, and nothing else writes to the database. |
| September Patrol plan rebuild | Skipped until a Patrol workings export is available. |
| Browser: save_guard.py | In a real browser, the live address saves and a test link reads but never writes, shows the test version banner and shows Not saved. |
| Browser: network guard | Every request the page makes is either handled by the check or blocked, so no browser check can reach a real server other than the listed library files. Probe requests confirm the block works; any other blocked request fails the check. |

## Folders

- `legacy/engine_46aaae2.js`: the engine extracted from index.html at GitHub commit 46aaae2. Never edit it.
- `fixtures/`: `rac_data_46aaae2.json.gz` is the repo data file at that commit. The two `smr_sept_*.json` files hold the raw monthly rows and the per-row results from the plan 2a and 16 September workings exports.
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
