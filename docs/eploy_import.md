# Re-running the Eploy import

The planner's screening pass rates and hire rates come from RAC's Eploy
application report. The report holds candidate-level data, so it never goes in
the repo. The import turns it into counts by role, region, platform and
application month (`data/eploy_rates.json`), and only that file is committed.

## When a new dataset arrives

1. Work on a branch, never main.
2. If the workbook came straight from a formula-based export, open it in Excel
   and save it, so the Hired and Progressed Past Screening columns hold values.
3. From the repo folder, run:

       python tools/eploy_import.py "PATH/TO/the new workbook.xlsx"

   Needs Python 3 with openpyxl (`pip install openpyxl`).
4. Read what it prints:
   - **Labels not in data/eploy_mappings.csv.** Add a row for each new label
     (role, region or source) with what it should count as, then re-run. Sources
     map to indeed, meta, google, appcast or other.
   - **Unexpected values.** Hired and Progressed Past Screening must read TRUE or
     FALSE; application dates must fall between `eploy_first_month`
     (assumptions.csv) and the file's own date.
   - **Shifts above 10%.** Counts for months both files hold moved by more than
     10% (on counts of 20 or more). Find out why before accepting. If the change
     is expected, re-run with `--accept-changes`.
5. Run the checks with the workbook path set, so the committed file is confirmed
   against it:

       RAC_EPLOY_WORKBOOK="PATH/TO/the new workbook.xlsx" node tests/run.mjs

6. Commit `data/eploy_rates.json` (and the mappings file if changed), push the
   branch, check the plans on its test link, then merge.

The workings export and PDF show the dataset's file name and date, taken from
`data/eploy_rates.json`.

## How the months are used

Outcomes take time to be recorded, so recent application months are left out
until they settle (`assumptions.csv`):

- `screening_maturity_months`: a month's screening results count once this many
  further months have started by the file's date.
- `hire_maturity_months`: the same for hires.

Applications with no region are counted in role totals only, and the import
reports how many there were.
