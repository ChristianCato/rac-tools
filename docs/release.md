# Releasing

What to do to put the `c3-build` release live, in order, and who does each
step. Everything here is done by a person; nothing releases itself.

- **Biraag** runs the checks and checks the plan on the test link (steps 1 and 2).
- **The app author** does everything else (steps 3 to 14).

Nothing merges until Biraag says his check on the test link has passed.

## The live address is moving

The live app is moving to **`https://rac-tools-kappa.vercel.app`**, on the
Enhance Vercel account. The old address, `https://rac-tools.vercel.app`, is on
a personal account and is being retired.

During the move both addresses can save: the app keeps a list of live
addresses (`SAVE_HOSTS` in `index.html`), and every other address, including
every test link, reads the live data but never writes. Both addresses use the
same database, so plans saved on one appear on the other. Once the old address
is retired (step 13), it is taken off the list.

If the old project on the personal account does not build from this
repository's `main`, the old address keeps serving the previous version after
the merge, which saves from anywhere and has none of this release's
calculations. That is another reason to move the team to the new link straight
after the merge (step 11).

## The archive, in short

Plans made before this release keep working exactly as they do today, in a
read-only copy of today's app: the **archive**. It lives on the same address as
the app, at `https://rac-tools-kappa.vercel.app/archive/`. There is no second
Vercel project, no second link to share and no second sign-in set-up. The file
is `archive/index.html` and it goes live with the merge like everything else.

The archive reads its own copy of the saved plans and data, stored in the
database under `archive:workspace`, `archive:benchmarks` and
`archive:hire_rates`. The new release takes that copy by itself the first time
it opens on a live address (step 7), before it writes anything of its own.

The archive is the app as it was at commit 46aaae2, with one fix to how it
behaves: the header SMR and Patrol buttons now switch role (they called
`setExportRole`, which did not exist, so they did nothing). It is the same fix
as the author's commit aa01c14 on main. It lets Patrol plans be opened and
exported from the header; no calculation changed. Everything else in the
archive is frozen.

## Checks (Biraag, before the merge)

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

   `save_guard.py` confirms that both live addresses save and that a test link
   does not.

2. **Check one plan on the test link**, using `docs/check_list.md`, which walks
   through every screen and export the release changed and takes about an hour
   and a half. The test link cannot save: it shows "Not saved" and a banner
   saying so.

## Settings to confirm (app author, once, before the merge)

3. **Supabase sign-in.** In Supabase, Authentication, URL Configuration:
   - **Site URL:** `https://rac-tools-kappa.vercel.app`, so sign-in emails send
     people to the new address by default.
   - **Redirect URLs** must include `https://rac-tools-kappa.vercel.app/**`
     (with the `/**`). The app's sign-in link returns to the page it was sent
     from, so the archive's returns to
     `https://rac-tools-kappa.vercel.app/archive/`, and only the `/**` form
     allows that. Keep `https://rac-tools.vercel.app/**` in the list until the
     old address is retired (step 13), and the test link entries
     (`https://rac-tools-*-enhance-media-rac.vercel.app/**` and
     `https://rac-tools-git-*-enhance-media-rac.vercel.app/**`) as they are.

   Nothing else is needed for the archive: someone already signed in to the app
   in the same browser is already signed in to the archive.

4. **The new project's settings.** In the Enhance Vercel project behind
   `rac-tools-kappa.vercel.app`:
   - The environment variables the spend pull needs (Windsor and Supabase) are
     set for Production, the same as on the old project.
   - "Enable access to System Environment Variables" is already ticked, so the
     version stamp can read the deployed code version. Nothing to change; step 9
     checks it.

## Release (app author, after Biraag's check has passed)

5. **Keep the exports the archive will be compared against.** Before merging,
   from the live app the team uses today, export the PDF and the workings for
   each saved plan that matters (at least the September SMR and Patrol plans).
   Keep them with the date. These are the copies the archive is checked against
   in step 8.

6. **Back up the shared state.** Sign in to the live app and use "Back up" in
   the header, which downloads the whole workspace as a file. Keep it somewhere
   safe until the release has settled.

7. **Merge `c3-build` into `main`** (open a pull request on GitHub from
   `c3-build` to `main` and merge it). Vercel builds it and
   `rac-tools-kappa.vercel.app` follows in a minute or two. **Straight after,
   sign in to `https://rac-tools-kappa.vercel.app` once, before anyone starts
   editing.** That first load takes the archive copy. To confirm it happened,
   open the `rac_state` table in Supabase and check that rows
   `archive:workspace`, `archive:benchmarks` and `archive:hire_rates` are there,
   with today's date in `updated_at`.

   If they are not there, take the copy by hand in the Supabase SQL editor. It
   never writes over an archive row that already exists:

       insert into rac_state (k, v, updated_at)
       select 'archive:' || k, v, now() from rac_state
       where k in ('workspace', 'benchmarks', 'hire_rates')
       on conflict (k) do nothing;

   Do this before anyone changes a plan in the new release, because the copy is
   meant to be the plans as they were on release day.

8. **Check the archive.**
   - Open `https://rac-tools-kappa.vercel.app/archive/`. It should show the
     amber banner "Archive: pre-release plans, read-only".
   - Open each saved plan from step 5 and export its PDF and workings.
   - Compare them with the copies from step 5. The text and the figures should
     match. If they do not, say so before anyone relies on the archive; do not
     change the archive to make them match.

9. **Check the version stamp.**
   - Open `https://rac-tools-kappa.vercel.app/api/windsor-spend?version=1`. It
     should show a `commit` that is not null, and its first seven characters
     should match the merge commit on `main` in GitHub.
   - In the app, open the Method tab: the stamp at the foot reads "Code" and
     the same seven characters, not "Code unknown". Export any PDF and check the
     stamp at the foot of its pages says the same.
   - If it reads "Code unknown", check the setting in step 4 and redeploy.

10. **Check the new release** on `https://rac-tools-kappa.vercel.app`: the
    "Test version" banner is gone, the header says "Saved", and "Get spend from
    Windsor" on the pacing screen still works (it relies on the project's
    environment variables from step 4).

11. **Tell the team the link has changed.** Send the new link,
    `https://rac-tools-kappa.vercel.app`, and ask everyone to update their
    bookmarks and sign in there from now on. Say that the old link will stop
    working on a set date (step 13), and that nothing needs moving: plans and
    data are the same on both, because both use the same database.

12. **Tell the team about the archive.** Plans made before the release are in
    the archive at `https://rac-tools-kappa.vercel.app/archive/`, and plans made
    from now on are in the live app. Reopening a pre-release plan in the live
    app will show different figures, because the calculations changed; that is
    what the archive is for.

13. **Retire the old address**, on the date given in step 11, once nobody is
    using it:
    - On the personal Vercel account, remove the `rac-tools.vercel.app` project
      (or at least its production deployment), so the old link no longer opens
      the app.
    - In Supabase, Authentication, URL Configuration, remove
      `https://rac-tools.vercel.app/**` (and the bare address) from the
      redirect URLs.
    - In `index.html`, take `'rac-tools.vercel.app'` out of `SAVE_HOSTS`. Update
      the check "Only the live addresses can write to the database" in
      `tests/run.mjs` to expect the new address alone, and in
      `tests/browser/save_guard.py` change the old live address from a page
      that must save to one that must not. Make the change on a branch, run the
      checks, check it on its test link and merge, like any other change.
    - Check that the old link no longer opens the app and that the new one
      still saves.

14. **If something goes wrong after the merge**, revert the merge on `main`
    (GitHub, the merged pull request, "Revert"). The previous version only reads
    `workspace`, `benchmarks`, `hire_rates` and the presence rows, so the
    `archive:`, `issued:` and change-record rows can stay where they are. The
    back-up from step 6 restores the workspace if it was damaged. The previous
    version has no list of live addresses and saves from any address, so after
    a revert, test links would write to the live data again: avoid using them
    until the release is put back. Do not retire the old address until the
    release has settled.

## Issued plans

A plan that has been sent to RAC should be marked as issued, using the button
beside the plan picker. It is then stored exactly as it was, under its own
record, written once, and everything about it (the screens, the PDF, the
workings) comes from that record afterwards. An issued plan cannot be renamed,
deleted or written over from the app, and editing it starts a new plan instead.

Still on the app author's list, not needed for this release: a rule in the
database so that nobody with direct access can change an issued plan
(`issued:` rows) or the archive copy (`archive:` rows).

## Rebuilding the archive app

`archive/index.html` is generated, never edited by hand:

    python tools/build_archive.py

It reads `tests/legacy/index_46aaae2.html`, the app exactly as it was at commit
46aaae2, and makes the short list of changes its own comment sets out: the
archive title, heading and banner, the 46aaae2 data file, no writes, reads from
the archive copy, no presence, the month list worked out before the database
answers, and (since 18 September) the header role buttons calling
`setRoleView`. A check confirms the committed file is what the script builds,
and `tests/browser/archive_checks.py` clicks the header Patrol button and
exports the Patrol workings and PDF.
