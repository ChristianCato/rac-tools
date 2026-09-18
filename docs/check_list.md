# Checking the release on the test link

About an hour. Work through it in order and write down anything that looks
wrong; nothing here changes the live app, because a test link cannot save.

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

## 3. The PDF (10 minutes)

1. Press PDF in the header.
2. Read the summary page as if you were RAC. Does it answer "what will this
   buy, and how sure are you?"
3. Check the assumptions and risks box: spend above past levels, the cap
   multiple, the adjustment, other-source hires, the months used, fees, the
   attribution note, and any cost limits.
4. Turn to a location and platform page. Follow one row left to right: historic
   cost, the adjustments, planned cost, applications, quality rate, hire rate,
   hires. Does the arithmetic hold?
5. Check the method and glossary pages read the way you would say it. The
   definition of a quality application should end "Repeat applications from
   the same candidate are not counted unless they had already passed
   screening."
6. Check the stamp at the foot of each page: a short code, the Eploy file and
   date, the month the ad data runs to and the assumptions date. It should hold
   no link and name nothing about where the app is kept or hosted.
7. Press "PDF, no notes" and confirm only the notes page is missing.

## 4. The workings (10 minutes)

1. Press Workings. Open the file.
2. On the Summary sheet, check the budget block adds up.
3. On the Workings sheet, click any figure and look at the formula bar. It
   should point at another sheet, not hold a number.
4. Follow one row using `docs/trace_guide.md`, which does exactly that for
   South East Indeed.
5. Check the Data sources sheet shows where each month came from and what it
   counts for, and that August is marked as not counting until its data has
   settled.

## 5. The new screens (10 minutes)

1. **Assumptions tab.** Every value, what this plan used, what testing gave,
   where it came from and when it was set. Check nothing says "set for this
   plan" that you did not set.
2. **OneRAC tab.** Tick a location, set a month, a budget and a hire target.
   Check the plan appears, that the SMR and Patrol plans lose that location,
   and that each shows a OneRAC hold-back. Then untick it.
3. **Setup, cost limits.** Set a low cost per application on one location and
   platform and watch the plan move; then clear it.
4. **Setup, market guide.** Cost per click and per thousand impressions are in
   pounds, with each platform's average beside them. Check the months read
   sensibly against what you know about the market.
5. **Changelog screen.** Your changes above should be listed, with your name.
   The release notes on the same screen should say nothing about where the app
   is kept or hosted.

## 6. Issued plans and the archive (5 minutes)

1. Save a plan ("Save as new plan"), then press "Mark as issued". On the test
   link it will tell you nothing was stored, because a test link never writes.
   That is the right answer.
2. Add `/archive/` to the end of the test link's address. It should show the
   amber banner "Archive: pre-release plans, read-only". It will have no plans
   in it yet: the archive's copy of the plans is only taken when the release
   first opens on the live address, after the merge. Comparing archived plans
   with the live app's exports is a release step for the app author (step 8 of
   `docs/release.md`).

## 7. What to say afterwards

- Anything that looked wrong, with the screen and the figure.
- Anything you would want RAC not to see in the PDF.
- Whether the plan's figures are close enough to your own judgement to send.

If something is wrong, it is better to say so than to merge. Nothing in this
release is urgent enough to send a plan you do not believe.
