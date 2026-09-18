# Checking the release on the test link

About an hour and a half. Work through it in order and write down anything that
looks wrong; nothing here changes the live app, because a test link cannot save.

Open the branch's test link,
`https://rac-tools-git-c3-build-enhance-media-rac.vercel.app`, and sign in. You
should see the amber banner "Test version. Nothing you change here is saved"
and "Not saved" where the live app says "Saved". If you do not, stop: you are
on the live app.

## 1. Does it open and does it add up (10 minutes)

1. Go to the Plan tab for SMR, October 2026.
2. Check the four figures at the top read sensibly, and that the locations
   table adds up to the total.
3. Switch to Patrol with the buttons at the top right, then back to SMR. The
   figures should follow the role and come back the same.
4. Look for the line about the budget the plan could not place, and for the
   line about the spending caps if the target is out of reach. Both should say
   plainly what is happening.

## 2. Does it match what you expect (15 minutes)

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

Since the last version of this list, June 2026 applications count in the
quality and hire rates. June's quality rate was lower than earlier months, so
the quality test on the spending caps now sets aside more June months, and the
budget not placed is higher (see BUILD_PROGRESS.md for the figures).

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
   - There is now a "Months used" section: one line per part of the model,
     saying which months it used, how they were weighted, and whether that
     follows the data window set for the plan or a fixed rule. Check it
     agrees with the summary page.
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
2. On the Summary sheet, check the budget block adds up, and read the new
   "Months used" block near the bottom. It should say the same as the PDF.
3. On the Workings sheet, click any figure and look at the formula bar. It
   should point at another sheet, not hold a number.
4. Follow one row using `docs/trace_guide.md`, which does exactly that for
   South East Indeed. Its figures were updated for June 2026 counting.
5. On the Data sources sheet, "Where it came from" should read "Original
   monthly data" or "Later monthly update", and August should be marked as not
   counting until its data has settled. The Weight column should follow the
   window on Benchmarks: for "Year to date, recent weighted" at 2x, January to
   April 2026 at 1 and May to July 2026 at 2.
6. On the Back-test sheet, the note above the table should read "Window: year
   to date, with the last three months counted x2". (It used to print
   "[object Object]".)
7. On the Assumptions sheet, the heading note should read "Every value comes
   from one agreed list of assumptions, held apart from the calculations", and
   the notes should name no files. The data source reads "RAC's monthly SMR
   spend and application data, to August 2026".

## 5. The data window and upweighting (10 minutes)

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
5. On Benchmarks, choose "Last 3 months", then "All time", and watch the Plan
   tab each time. On the data held, "Last 3 months" gave the highest cost per
   application and "All time" the lowest.
6. Set it back to what it showed in step 2. The test link does not save, but
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
   show the OneRAC budget and the same "Months used" block.
6. Untick the location.

## 7. Nothing that tells RAC the tool exists (10 minutes)

RAC should see a plan from Enhance, not a tool. Open the SMR PDF, the "PDF, no
notes" version, the SMR workings and the OneRAC PDF. In each, use Find (Ctrl+F;
in Excel, Find All with "Within: Workbook" and "Look in: Values") for:

- app, tool, website, Setup, screen, button, saved, upload
- .csv, .js, json, rac_data
- repository, GitHub, Vercel, Supabase, public, database, branch
- [object

Find also matches inside longer words, so ignore any match that is part of a
longer word: "applicant", "application", "apply", "applied", "Appcast",
"capped" and "happened" (for app), and "screening" (for screen). On the
workings Assumptions sheet, the Key column holds setting names such as
"cpa_prior_apps" and "screen_blend_n"; ignore those too. Apart from those,
nothing should be found. The Eploy dataset's own file name appears in the stamp
and notes, which is expected: it is RAC's own file. The exports run a
whole-word version of this search themselves and refuse to save a document
that fails it, so a find here means something slipped past that check.

## 8. The other new screens (10 minutes)

1. **Assumptions tab.** Every value, what this plan used, what testing gave,
   where it came from and when it was set. Check nothing says "set for this
   plan" that you did not set. This tab is for the team, so it still names the
   assumptions file and links to its history.
2. **Setup, cost limits.** Set a low cost per application on one location and
   platform and watch the plan move; then clear it.
3. **Setup, market guide.** Cost per click and per thousand impressions are in
   pounds, with each platform's average beside them. Check the months read
   sensibly against what you know about the market.
4. **Changelog screen.** Your changes above should be listed, with your name.
   The release notes on the same screen should say nothing about where the app
   is kept or hosted.

## 9. Issued plans and the archive (5 minutes)

1. Save a plan ("Save as new plan"), then press "Mark as issued". On the test
   link it will tell you nothing was stored, because a test link never writes.
   That is the right answer.
2. Add `/archive/` to the end of the test link's address. It should show the
   amber banner "Archive: pre-release plans, read-only". It will have no plans
   in it yet: the archive's copy of the plans is only taken when the release
   first opens on the live address, after the merge. Comparing archived plans
   with the live app's exports is a release step for the app author (step 8 of
   `docs/release.md`).

## 10. What to say afterwards

- Anything that looked wrong, with the screen and the figure.
- Anything you would want RAC not to see in the PDF or the workings.
- Whether the plan's figures are close enough to your own judgement to send.

If something is wrong, it is better to say so than to merge. Nothing in this
release is urgent enough to send a plan you do not believe.
