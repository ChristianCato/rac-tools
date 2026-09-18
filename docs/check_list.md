# Checking the release on the test link

About an hour and a half. Work through it in order and write down anything that
looks wrong; nothing here changes the live app, because a test link cannot save.

Open the branch's test link,
`https://rac-tools-git-c3-build-enhance-media-rac.vercel.app`, and sign in. You
should see the amber banner "Test version. Nothing you change here is saved"
and "Not saved" where the live app says "Saved". If you do not, stop: you are
on a live address. The live app is moving to `https://rac-tools-kappa.vercel.app`;
the old `https://rac-tools.vercel.app` also saves until it is retired. Neither is
the test link.

## 1. Does it open and does it add up (10 minutes)

1. Go to the Plan tab for SMR, October 2026.
2. Check the four figures at the top read sensibly, and that the locations
   table adds up to the total.
3. Switch to Patrol with the buttons at the top right, beside the export
   buttons, then back to SMR. The figures should follow the role and come back
   the same.
4. Look for the line about the budget the plan could not place, and for the
   line about the spending caps if the target is out of reach. Both should say
   plainly what is happening.

## 2. Does it match what you expect (20 minutes)

This is the part only you can do.

1. Pick two locations you know well, one big and one thin.
2. On the Plan tab, look at their spend, applications, hires and cost per hire.
3. Ask: would you have planned roughly that? If not, write down which figure
   looks wrong and by how much.
4. Do the same for one platform across locations.

The figures are lower than the plans RAC has had before. That is the point of
the change: cost per application now rises with spend, spending caps hold the
plan to months that actually worked, and hires come from the applicant tracking
data rather than a fixed rate. The comparison table in BUILD_PROGRESS.md (in
the data folder) sets out how much each of those moved the September plan.

Since the last version of this list, these things changed the figures (see
BUILD_PROGRESS.md for the numbers):

- June 2026 applications count in the quality and hire rates.
- The spending caps' quality test now judges a location against what was
  expected for it that month, taking account of that month's quality across all
  locations. June's quality was lower everywhere, so June months are no longer
  set aside for that alone.
- A month counts towards a cap if its cost per application was at or below the
  location and platform's own usual cost across the settled 2026 months,
  adjusted for that month's spend, with no remaining-error adjustment. 2025
  months are left out because that data was put together differently and does
  not compare (the same reason they are left out of the months the caps look
  at). This does not depend on the data window, so the caps are the same
  whichever window is chosen.
- Two further limits keep caps to what a location could take in one month:
  - A location cannot be planned above the most it spent in one month, all
    platforms together, x the spending cap multiple (settled 2026 months).
    Row caps are set separately and added up, so without this a location
    could be allowed more than it has ever run.
  - A row's cap cannot rest on a month above twice its usual monthly spend
    (the average of the 2026 months it spent in), so one unusual month cannot
    set a cap.
  Both values are in assumptions.csv (cap_location_month_limit 1,
  cap_row_usual_limit 2, source agreed); 0 turns either off. There is no limit
  on the plan as a whole.
- The header SMR and Patrol buttons now also work in the archive (section 9).

Now sanity-check the figures with the new caps in place:

5. Look at the budget the plan could not place. It is higher than after the
   benchmark change alone, because the two limits hold some locations and rows
   below what they were allowed before. Budget the plan cannot place is a real
   result: it says the plan would be spending more in a place than it has ever
   absorbed in a month. It is not something to tune away. On the October SMR
   plan with the September plan 2a settings and the Patrol plan with its
   September settings, the budget not placed was:

   | | Before today's changes | 2026 benchmark only | With both limits |
   |---|---|---|---|
   | SMR, multiple 1 | £49,225 | £43,797 | £46,191 |
   | SMR, multiple 2 | £22,340 | £15,563 | £19,805 |
   | Patrol, multiple 1 | £12,369 | £6,762 | £7,365 |
   | Patrol, multiple 2 | £5,157 | £2,180 | £2,439 |

   The plans on the test link may use other settings, so expect the same
   direction rather than the same pounds. Ask: for the locations you know, does
   the amount left over look like more than they could really take?
6. Check where the limits hold. On those settings:
   - The location cap held **North West** and **Yorkshire & Humber** (SMR):
     their platforms' caps added up to more than either had ever spent in a
     month. On the locations page of the PDF their notes read "at location
     spending cap (largest month x multiple)". Patrol South East and North East
     had location caps below their row caps, but the plan did not reach them.
   - The row limit held 12 rows to twice their usual monthly spend. SMR: South
     East Appcast, London Appcast (London is set to no spend in those
     settings), North West Indeed, North West Meta, Yorkshire & Humber Indeed,
     Yorkshire & Humber Appcast. Patrol: South East Appcast, West Midlands
     Google, North West Google, Scotland Indeed, Scotland Meta, Scotland Google.
     In the PDF their cap basis reads "2x usual".
   Ask: for the rows you know, was the month the cap used to rest on really a
   one-off? Scotland Patrol Indeed, for example, spent £3,223 in July 2026
   against a next best month of £928.

## 3. The PDF (15 minutes)

1. Press PDF in the header.
2. Read the summary page as if you were RAC. Does it answer "what will this
   buy, and how sure are you?"
3. Check the assumptions and risks box: spend above past levels, the cap
   multiple, the adjustment, other-source hires, fees, the attribution note,
   any cost limits, and the "Months used" line. That line should name the
   months for cost per application (with the months counted twice), spending
   caps, quality rates, hire rates, other-source hires, testing and ranges.
4. Turn to a location and platform page. Follow one row left to right: historic
   cost, the adjustments, planned cost, applications, quality rate, hire rate,
   hires. Does the arithmetic hold?
5. Read the method and glossary pages.
   - There is a "Months used" section: one line per part of the model, saying
     which months it used, how they were weighted, and whether that follows
     the data window set for the plan or a fixed rule. Check it agrees with the
     summary page. The spending caps line should name the months the caps
     looked at (January to July 2026) and say the cost benchmark used the same
     months. No 2025 month should appear on it.
   - The "Spending caps" section should describe the benchmark (each location
     and platform's own usual cost over the settled months since January 2026,
     adjusted for that month's spend, with the reason earlier months were left
     out) and the quality test (against what was expected for that location
     that month, given quality across all locations).
   - The same section, and the spending caps line in "Months used", should
     state both limits: a cap rests on no more than 2 x usual monthly spend,
     and each location has its own cap of the most it spent in one month, all
     platforms together, x the multiple. It should say there is no limit on
     the plan as a whole.
   - The glossary should have "Spending cap" (mentioning the 2 x usual limit)
     and "Location spending cap".
   - On the locations page, a location held by its own cap shows "at location
     spending cap (largest month x multiple)" in the notes. On a platform page,
     a row held by the usual-spend limit shows "2x usual" in its cap basis.
   - The definition of a quality application should end "Repeat applications
     from the same candidate are not counted unless they had already passed
     screening."
   - Settings are described as "set for the plan" or "set for this plan". The
     settings screen is not named anywhere.
6. Check the stamp at the foot of each page: a short code, the Eploy file and
   date, the month the ad data runs to and the assumptions date. It should hold
   no link and name nothing about where the app is kept or hosted.
7. Press "PDF, no notes" and confirm only the notes page is missing.

## 4. The workings (10 minutes)

1. Press Workings. Open the file.
2. On the Summary sheet, check the budget block adds up, and read the
   "Months used" block near the bottom. It should say the same as the PDF.
3. On the Workings sheet, click any figure and look at the formula bar. It
   should point at another sheet, not hold a number.
4. Follow one row using `docs/trace_guide.md`, which does exactly that for
   South East Indeed. Its figures were updated for the 2026 cost benchmark and
   the two cap limits, and section 5 now covers the South East's location cap.
5. On the Data sources sheet, "Where it came from" should read "Original
   monthly data" or "Later monthly update", and August should be marked as not
   counting until its data has settled. The Weight column should follow the
   window on Benchmarks: for "Year to date, recent weighted" at 2x, January to
   April 2026 at 1 and May to July 2026 at 2.
6. On the Back-test sheet, the note above the table should read "Window: year
   to date, with the last three months counted x2". (It used to print
   "[object Object]".)
7. On the Successful months sheet, the column after cost per application is
   "Benchmark at that spend", and the quality test reads, for example, "19.1%
   against 17.4% expected (usual 22.3% x 0.78 for the month): passed". Pick one
   row and check the month was counted only if its cost was at or below the
   benchmark and the quality test passed. A row whose cap is held by the
   usual-spend limit says "largest successful month held to 2 x usual monthly
   spend" on its cap line.
   Below the rows, "Location spending caps" lists each location's biggest
   month by platform, the location cap, the platform caps added up and which
   of the two held. Check one location's month against the Data sources
   sheet.
8. On the Assumptions sheet, the heading note should read "Every value comes
   from one agreed list of assumptions, held apart from the calculations", and
   the notes should name no files. The data source reads "RAC's monthly SMR
   spend and application data, to August 2026". The two cap limits are listed.

## 5. The data window and upweighting (15 minutes)

1. On the Plan tab for SMR, write down predicted applications, hires and cost
   per application.
2. Go to Benchmarks, SMR, and note which window it shows (a new workspace
   starts on "All time"; the live workspace keeps whatever was last chosen,
   which for the September plans was "Year to date, recent weighted" at 2x).
   Choose "Year to date, recent weighted" with "Last 3 months count" at 2x,
   note the Plan tab figures, then change it to 3x.
3. Back on the Plan tab, cost per application should rise and applications
   fall, because May to July 2026 cost more than January to April. If the
   figures do not move, write it down.
4. Press PDF. The "Months used" line and the method section should now say
   "May to July 2026 counted three times". Quality rates, hire rates, spending
   caps, other-source hires and testing should still name the same months as
   before: they follow fixed rules, not the window.
5. Pick two location and platform rows in the PDF and note their spending
   caps, and one location's spending room on the locations page. The caps and
   the location caps should be exactly the same under 2x, 3x and the windows
   in the next step. Spend, applications and cost per application move with
   the window; the caps do not. (The budget not placed can still move a
   little, because the split within a location follows the window.)
6. On Benchmarks, choose "Last 3 months", then "All time", and watch the Plan
   tab each time. On the data held, "Last 3 months" gave the highest cost per
   application and "All time" the lowest.
7. Set it back to what it showed in step 2. The test link does not save, but
   leave it as you found it.

## 6. The OneRAC plan and its PDF (10 minutes)

1. Open the OneRAC tab. Tick a location, set a month, a budget and a hire
   target. Check the plan appears, that the SMR and Patrol plans lose that
   location, and that each shows a OneRAC hold-back.
2. Press PDF on the OneRAC tab and open the OneRAC PDF.
3. Read the summary page and the locations and platforms pages as you did for
   SMR. The title should name OneRAC and the hire target.
4. Read its method pages: they should include "The OneRAC plan" section (which
   locations, open roles by role, how cost per application was blended to the
   mix of roles, and the self-competition assumption) and the "Months used"
   section. Then read its glossary.
5. Press Workings on the OneRAC tab and open the file; the Summary sheet should
   show the OneRAC budget and the same "Months used" block. Keep this file and
   the OneRAC PDF open for section 7.
6. Untick the location.

## 7. Nothing that tells RAC the tool exists (10 minutes)

RAC should see a plan from Enhance, not a tool. Open the SMR PDF, the "PDF, no
notes" version, the SMR workings, the OneRAC PDF and the OneRAC workings. In
each, use Find (Ctrl+F; in Excel, Find All with "Within: Workbook" and "Look
in: Values") for:

- app, tool, website, Setup, screen, button, saved, upload
- .csv, .js, json, rac_data
- repository, GitHub, Vercel, Supabase, public, database, branch
- [object

Find also matches inside longer words, so ignore any match that is part of a
longer word: "applicant", "application", "apply", "applied", "Appcast",
"capped" and "happened" (for app), and "screening" (for screen). On the
workings Assumptions sheet, the Key column holds setting names such as
"cpa_prior_apps", "screen_blend_n" and "cap_row_usual_limit"; ignore those too.
Apart from those, nothing should be found. The Eploy dataset's own file name
appears in the stamp and notes, which is expected: it is RAC's own file. The
exports run a whole-word version of this search themselves and refuse to save a
document that fails it, so a find here means something slipped past that check.

## 8. The other new screens (10 minutes)

1. **Assumptions tab.** Every value, what this plan used, what testing gave,
   where it came from and when it was set. Check nothing says "set for this
   plan" that you did not set. The two new cap limits (cap_location_month_limit
   1 and cap_row_usual_limit 2) appear with source agreed. This tab is for the
   team, so it still names the assumptions file and links to its history.
2. **Setup, cost limits.** Set a low cost per application on one location and
   platform and watch the plan move; then clear it.
3. **Setup, market guide.** Cost per click and per thousand impressions are in
   pounds, with each platform's average beside them. Check the months read
   sensibly against what you know about the market.
4. **Changelog screen.** Your changes above should be listed, with your name.
   The release notes on the same screen should include the two cap limits, and
   should say nothing about where the app is kept or hosted.

## 9. Issued plans and the archive (10 minutes)

1. Save a plan ("Save as new plan"), then press "Mark as issued". On the test
   link it will tell you nothing was stored, because a test link never writes.
   That is the right answer.
2. Add `/archive/` to the end of the test link's address. It should show the
   amber banner "Archive: pre-release plans, read-only". It will have no saved
   plans in it yet: the archive's copy of the plans is only taken when the
   release first opens on the live address, after the merge. It still shows a
   plan worked out on its default settings.
3. In the archive, press **Patrol** in the header, beside the export buttons.
   The header and the Plan tab should both switch to Patrol and show Patrol
   figures. Press Workings and PDF: the files should be named for Patrol
   (for example "RAC_October_2026_Patrol_Plan.pdf"). Press **SMR** and the SMR
   figures should come back. Before this release these header buttons did
   nothing in the old app; the archive now carries the same one-word fix the
   app author made on main, and nothing else about it has changed.
4. After the merge, once the archive holds the saved plans, open a saved
   Patrol plan in the archive and repeat step 3 on it. Comparing archived plans
   with the live app's exports is a release step for the app author (step 8 of
   `docs/release.md`). A difference of a few SMR applications there (1,400
   against 1,402 in testing) is a known fault of the previous calculations,
   not of the archive, and is expected.

## 10. What to say afterwards

- Anything that looked wrong, with the screen and the figure.
- Anything you would want RAC not to see in the PDF or the workings.
- Whether the plan's figures are close enough to your own judgement to send.

If something is wrong, it is better to say so than to merge. Nothing in this
release is urgent enough to send a plan you do not believe.
