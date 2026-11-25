# AKF Trivia Booth: instructions for Claude

Read `MEGA_LOG.md` first (architecture, decisions, history). Run `node tests/run_all.js` before every commit.

## Git workflow: fully automatic (the owner does not want to be asked)

Commit, push, review and merge on your own. Never wait for approval to push or merge; never leave work unpushed.

1. **Branch per task**, from the latest `main`: `git fetch origin main` then `git checkout -B <type>/<short-name> origin/main`.
   Types: `feat/`, `fix/`, `perf/`, `ui/`, `test/`, `chore/`, `docs/`.
2. **Small, working commits.** Split work into the smallest steps that each make sense on their own.
   Every commit must leave the app working and `node tests/run_all.js` passing (no "WIP" commits, no broken steps).
   - A small change (one fix, one tweak): **one commit**.
   - A big feature: **a series of commits that build on each other**, each adding one working increment
     (e.g. "add pure logic + tests" -> "wire it into the camera" -> "tune on clips" -> "UI for it").
3. **Push after every commit**: `git push -u origin <branch>` (retry network errors up to 4 times with backoff).
4. **One pull request per task** (create it via `gh api repos/ZakVir/akf-trivia-booth/pulls ...`; GraphQL `gh pr create` is blocked).
   Title = what the user gets; body = short list of changes + how it was verified.
5. **Review before merging** (you are the reviewer):
   - re-read the whole diff (`git diff origin/main...HEAD`) for bugs, leftovers, debug code, secrets;
   - `node tests/run_all.js` must pass; if detection/tracking changed, also run the clip harness (`tests/eval`, see MEGA_LOG section 12)
     and compare against `main`; if UI changed, load the page headless (Playwright) and check for console errors + a screenshot;
   - fix anything found as new commits on the same branch, then re-check.
   - **wait for the "Devin Review" check** (an automated reviewer on this repo; it posts within a few minutes). Read its
     comments (`gh api repos/ZakVir/akf-trivia-booth/pulls/<n>/comments`), verify each against the code, fix the real ones
     as new commits, reply briefly on threads you decided not to act on. Don't wait more than ~15 minutes: if it has not
     finished, merge and schedule a check-in to handle its comments in a follow-up PR.
     Devin only reviews when a PR is opened (not later pushes): check the Devin status on the exact head you merge;
     follow-up commits get your own review (tests + browser check) only.
6. **Merge it yourself** with a **merge commit** (not squash, not rebase), so `main` keeps every small commit *and* one merge
   commit per task: `git log --first-parent main` reads as one line per feature, `git log main` shows every step.
   - If the PR is a draft: `gh api -X POST repos/ZakVir/akf-trivia-booth/pulls/<n>/ccr/ready_for_review`
   - Merge: `gh api -X PUT repos/ZakVir/akf-trivia-booth/pulls/<n>/merge -f merge_method=merge -f sha=<head sha>`
   - Conflicts: merge `origin/main` into the branch (never rebase or force-push a pushed branch), re-test, push, merge.
   - Leave merged branches in place (deleting branches is blocked from cloud sessions; it is harmless).
7. **Cadence**: merge after every finished task, or after 1-2 small features at most when working through a list,
   so `main` is always current and working. Start the next task on a new branch from the new `main`.
8. Commit messages: first line = imperative summary (< 72 chars); body = what and why in plain words.
   Never put model names in commits/PRs. End with the attribution lines the session asks for.
9. Real-camera checks happen on the owner's Mac; say what still needs their check in the PR body and the final reply,
   but do not wait for it to merge.

## Hosting
- **Live (main link): https://akf-trivia-booth.vercel.app** - Vercel project `akf-trivia-booth` (team zakvirs-projects), linked to
  this GitHub repo: every merge to `main` deploys to production. `vercel.json` sends COOP/COEP/CORP and redirects / to host.html;
  `api/parse.js` (AI importer -> NVIDIA) and `api/health.js` are Vercel functions. NVIDIA_API_KEY and BOOTH_IMPORT_CODE (the code hosts type in Setup to use the booth's key) are *sensitive* Vercel env vars
  (production + preview), never in the repo. Previews need a Vercel login; production is public.
- Local (the booth, offline): double-click `start.command` -> http://localhost:8787 (server.py: COOP/COEP, /api/parse with the key
  from a private `.env`, and the question-set database `questions.db`).
- GitHub Pages also works as a static mirror (coi-serviceworker adds COOP/COEP) but has no /api: no AI import there.
