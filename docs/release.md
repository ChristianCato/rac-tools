# Releasing

What to do to put a change live, in order. Everything here is done by a person;
nothing releases itself.

## Before merging

1. **Run the checks** from the repo folder:

       node tests/run.mjs
       python tests/browser/save_guard.py
       python tests/browser/app_checks.py
       python tests/browser/export_checks.py
       python tests/browser/issued_checks.py
       python tests/browser/archive_checks.py

   Every line must read PASS or SKIP. A SKIP names what is missing; it is not a
   pass. Two checks need a file that is never committed, so set these first:

       RAC_EPLOY_WORKBOOK   the Eploy application report (candidate-level data)
       RAC_PACING_DIR       a folder holding the pacing exports to compare

2. **Check one plan on the test link**, using `docs/check_list.md`, which walks
   through every screen and export the release changed and takes about an hour.
   The test link cannot save: it shows "Not saved" and a banner saying so.

3. **Keep the exports you are going to compare against.** From the live app,
   export the PDF and the workings for each saved plan that matters (at least
   the September SMR and Patrol plans). These are the copies the archive is
   checked against in step 6.

## Merging

4. **Back up the shared state** before anything else: sign in to the live app
   and use "Back up" in the header, which downloads the whole workspace as a
   file. Keep it somewhere safe until the release has settled.

5. **Merge to main.** Vercel builds it and the live address follows.

## The archive

The archive app (`archive/index.html`) shows the plans made before this
release, worked out by the previous engine on the data as it stood. It is
served from the same address at `/archive/`, so it needs no separate sign-in
set-up.

6. **The copy is taken automatically.** The first time the new release loads on
   the live address, it copies `workspace`, `benchmarks` and `hire_rates` to
   `archive:workspace`, `archive:benchmarks` and `archive:hire_rates`, before it
   writes anything of its own. If those keys already exist it leaves them alone.
   So: **sign in to the live app once, straight after the merge, before anyone
   starts editing.** Then check the archive:

   - Open `https://rac-tools.vercel.app/archive/`. It should show the amber
     banner "Archive: pre-release plans, read-only".
   - Open each saved plan from step 3 and export its PDF and workings.
   - Compare them with the copies from step 3. The text and the figures should
     match. If they do not, say so before anyone relies on the archive; do not
     change the archive to make them match.

   If the copy did not happen (for example because the release was opened first
   on a test link), someone with database access can copy the three rows by
   hand: read `workspace`, `benchmarks` and `hire_rates` and write them to the
   three `archive:` keys. Never overwrite an `archive:` key that already exists.

7. **Tell the team** that plans made before the release are in the archive, and
   that plans made from now on are in the live app. Reopening a pre-release plan
   in the live app will show different figures, because the calculations
   changed; that is what the archive is for.

## Issued plans

A plan that has been sent to RAC should be marked as issued, using the button
beside the plan picker. It is then stored exactly as it was, under its own
record, written once, and everything about it (the screens, the PDF, the
workings) comes from that record afterwards. An issued plan cannot be renamed,
deleted or written over from the app, and editing it starts a new plan instead.

A rule in the database to stop anyone with direct access changing an issued
plan or an archive copy is still to be added: it is on the app author's list.

## Rebuilding the archive app

`archive/index.html` is generated, never edited by hand:

    python tools/build_archive.py

It reads `tests/legacy/index_46aaae2.html`, the app exactly as it was at commit
46aaae2, and makes the short list of changes its own comment sets out. A check
confirms the committed file is what the script builds.
