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
   - **Unexpected values.** Hired, Progressed Past Screening and Quality Applies
     must read TRUE or FALSE; every hired and every progressed application must
     be Quality Applies; no application at a "Rejected - Multiple Applications"
     stage may be Quality Applies; application dates must fall between
     `eploy_first_month` (assumptions.csv) and the file's own date.
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

## The quality measure

From the second version of the dataset (17 September 2026), quality is the
column **Quality Applies**: TRUE wherever Progressed Past Screening is TRUE,
plus applications closed at To Review or Call Back for a reason other than the
candidate's merit (location, salary, role filled, withdrawal, banked, silver
medallist). Repeat applications are not quality. It is used exactly as
provided. `data/eploy_rates.json` records which column was counted
(`quality_measure`); each row holds applications, quality applications, hires
and, for comparison, applications that progressed past screening.

Files without the column (the first version) import with
`--measure progressed`. To compare two versions without replacing the
committed file, write the results outside the repo and compare them:

    python tools/eploy_import.py OLD.xlsx --measure progressed --out "DATA FOLDER/old.json"
    python tools/eploy_import.py NEW.xlsx --out "DATA FOLDER/new.json" --previous "DATA FOLDER/old.json"
    node tools/compare_quality.mjs "DATA FOLDER/old.json" "DATA FOLDER/new.json"

Read every column by its header name. The audit scripts from the handover read
columns by position and must not be used with the second version (the role,
Location and Region columns moved one place right).

## How the months are used

Outcomes take time to be recorded, so recent application months are left out
until they settle (`assumptions.csv`):

- `screening_maturity_months`: a month's screening results count once this many
  further months have started by the file's date.
- `hire_maturity_months`: the same for hires.

Applications with no region are counted in role totals only, and the import
reports how many there were.
