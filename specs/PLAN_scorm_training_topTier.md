# Build Plan — Training / SCORM System: Top-Tier Pass

**Source request:** Issac, verbal — "make the training scorm system top tier... at least compete with" the best online training platforms. Two follow-up decisions already made: (1) audit first, don't lose what's built; (2) wants BOTH a great in-Hub experience AND real SCORM compliance (import AND export).
**Target repo:** `CalichesHub-Clean` · Supabase `ikgbihwkqhsfahnswfbz` (PROD, live)
**Author:** Audit + build-plan pass · **Status:** PLAN ONLY — no code edited, no SQL run.
**Rule reminders (house rules from this repo):** migrations ADDITIVE only · never rename a live RPC arg · every new RPC goes in `rpc_manifest.json` in the same change · verify against live schema before writing SQL (do not guess column types — see §7 note on the `v_uid uuid` bug found and fixed today).

---

## 1. What "top tier" means here

Two distinct outcomes, both wanted:

- **A genuinely good in-Hub training experience** — authoring, learner experience, assessment, analytics that hold up next to TalentLMS / Docebo / 360Learning / Lessonly.
- **True SCORM compliance** — not just "we call it SCORM." Real package **import** (already mostly built — see §3) hardened to spec, plus real package **export** (does not exist yet) so a course built in the Hub can be handed to another company's LMS as a standard SCORM 1.2/2004 zip.

---

## 2. Current state audit — three systems, one feature

The training feature is actually **three layers built at different times**, stacked on each other. Understanding the stack matters because Phase work below extends each layer differently.

```
Layer 3: trh_* "Training Hub" (training_hub.sql, training_finish.sql)
         Career paths → stages → requirements → certifications.
         A "digital_course" requirement just POINTS AT a Layer 1 course.
                        │
Layer 2: SCORM runtime + upload (js/01_part01.js, js/22_training_hub.js,
         scorm-player.html, edge-functions/scorm-upload.ts)
         Attaches to ONE Layer 1 course via lp_courses.scorm_url.
                        │
Layer 1: "My Training" / app_lp_* course engine (js/08_availability.js)
         The actual course catalog, lesson pages, quizzes, video.
         Schema: learning_paths / lp_courses / lp_course_completions
         (names inferred from usage — see gap #6, no .sql file defines them)
```

### Layer 1 — course engine (`app_lp_*`, `js/08_availability.js` lines 421-861)
- Real DB-backed catalog: paths → courses. Entry: `openLmsPreview()` / `lmsHome()` (line 452).
- Lesson pages: multi-page, each page raw HTML, authored as one `---`-delimited textarea (`tdCourseForm`, line 746).
- Video: native `<video>`, YouTube (iframe API), Vimeo (player API) — `lmsVideoEmbed` (line 503). Watch-gate blocks "Next" until ~95% watched (`lmsThr`, line 514), progress kept in **`localStorage`** (`cvw_w_<key>` etc., lines 524-533).
- Quiz: multiple-choice (auto-graded), short-answer (auto-graded only if an "accept" string is set), long-answer (**never graded** — see gap #1). Pass threshold from `app_settings.targets.lms_pass_pct` (default 80).
- Materials: uploaded/linked files, typed by extension (pdf/image/audio/video/doc) — `lmsMatsHtml` (line 855+).
- Gamification: points, badges, per-store leaderboard (`app_lp_gamify`, `app_lp_leaderboard`).
- Draft/publish workflow (`app_lp_set_status`), manager course/path editor (`tdCourseForm`, `tdEditPath`), CSV export of team progress (`tdExportCSV`, line 640).
- Auto-assign rules: by role / store / new-hire, run on-demand or via `app_lp_rules_run` (lines 794-843).

### Layer 2 — SCORM runtime (real, not fake)
- **Two SCORM API shims exist**, for two different hosting situations:
  - `js/01_part01.js:651-714` — `lmsBuildScormApi()` sets `window.API` / `window.API_1484_11` inline, used when content loads same-origin.
  - `scorm-player.html` — a standalone page with the *same* API shim, deployed **into the SCORM package's own storage folder** so cross-origin content (browsers block `iframe.contentWindow.parent` calls cross-origin) can still reach it.
- **Upload flow exists TWICE** — copy-pasted, not shared:
  - `js/01_part01.js:717-758` (`lmsUploadScorm` / `lmsScormDoUpload`) — from the course editor.
  - `js/22_training_hub.js:793-845` (`trhScormUpload` / `trhScormDoUpload`) — from the Training Hub Path Builder's requirement form.
  - Both: unzip client-side with JSZip → find `imsmanifest.xml` or an HTML file as the launch page → upload every file via the `scorm-upload` edge function (preserves folder structure so relative asset links keep working) → call `app_lp_set_scorm(course_id, url, version)`.
- `edge-functions/scorm-upload.ts` — manager-gated signed-upload-URL minter, hosts under `training-materials/scorm/<course_id>/<relpath>`. Solid.
- Completion recording: `app_scorm_record` (called from `scorm-player.html`) and `_scMaybeComplete()` → `app_lp_complete` (called from the inline shim). Two call paths into the same completion system — should confirm both write identical shapes.
- **No manifest parsing.** "Is this SCORM?" is decided by "does a file named imsmanifest.xml or *.html exist in the zip" — doesn't read the manifest for title/version/launch-file-per-SCO, doesn't validate structure, doesn't support multi-SCO packages (assumes one launch file for the whole package).
- **No cmi5/xAPI support** — SCORM's modern successor, increasingly expected by "top tier."
- **No export.** Nothing packages a Hub-authored course as a SCORM zip.

### Layer 3 — Training Hub career framework (`training_hub.sql` 1149 lines, `training_finish.sql` 671 lines, `js/22_training_hub.js` 859 lines)
- Paths → stages → requirements, 6 requirement kinds (digital_course, knowledge_check, ojt_practice, practical_signoff, external_credential, manager_approval).
- Enrollments, per-requirement records with photo evidence, sign-off requests, manager Path Builder.
- Certifications: issue/suspend/revoke/reinstate, all reason-required and audited, version-tracked so editing a path doesn't retroactively change what someone already earned.
- Ready-to-Start: paid pre-start onboarding with **server-side** session timing (start/end session, minutes capped, never trusts the client) and a payroll export.
- Quick Scoop: short refresher assignments by audience (role/store), with an optional one-question check.
- This layer is well-built — server-side time capture, audit trails, version-safety, and a good permission model are exactly what "top tier" back-office tooling should look like. Nothing here needs a rebuild, only Layer 1/2 integration polish (§4).

---

## 3. Gap list — concrete, not vibes

1. **Long-answer quiz questions are never graded.** `lmsSubmitQuiz` (`js/08_availability.js:576-582`): `gradable` only increments for multiple-choice and short-answer-with-accept-string. If a quiz is 100% long-answer, `gradable=0` → `score = gradable>0 ? ... : 100` → **auto-passes at 100% regardless of what was written.** This is a correctness bug, not a style gap — anyone leaning on long-answer questions as a real check is not actually being assessed.
2. **Course content authoring is a raw textarea.** Lesson pages are hand-typed HTML separated by literal `---` lines (`tdCourseForm`, line 746-762). No WYSIWYG, no image-in-text, no formatting toolbar. The project's own `MASTER_CHECKLIST.md` (line 38-40) already flags current lesson content as placeholder demo text waiting on a real editor.
3. **Video watch-progress is client-only.** Stored in `localStorage` keyed by a hash of the video URL (`lmsVidKey`, line 502). Doesn't sync across devices, is lost if the browser data is cleared, and can't be reported on by a manager ("has this person actually watched it" is unknowable server-side).
4. **SCORM upload logic duplicated verbatim** in `js/01_part01.js` and `js/22_training_hub.js` (~65 lines each, near-identical). Exactly the kind of drift risk that caused today's `v_uid uuid` vs `bigint` bug in three unrelated RPCs — a fix applied to one copy silently doesn't reach the other.
5. **No manifest parsing / package validation.** SCORM detection is "does a plausible filename exist in the zip," not manifest-driven. Multi-SCO packages, `<organizations>` structure, and stated SCORM version are all ignored.
6. **The Layer 1 schema has no migration file anywhere in the repo.** `learning_paths` / `lp_courses` / `lp_course_completions` (and whatever else backs `app_lp_*`) exist live in Supabase only — no `create table` statement is checked in. Every other feature in this repo has one (`training_hub.sql`, `training_finish.sql`, `employee_passport.sql`, etc.); this is the exception. All 20 `app_lp_*` RPC names ARE tracked in `rpc_manifest.json` (verified), so the *names* are governed — the actual column types and constraints are not. This needs to be reverse-engineered from live Supabase (`information_schema`) and written up before it's safe to extend, the same discipline that caught today's bug.
7. **No completion certificates.** Certifications in `trh_certifications` are database rows only — no generated PDF a person can keep, print, or show a licensing body. "Top tier" platforms auto-generate a certificate on pass.
8. **No real analytics.** The only reporting is a flat CSV export of current % complete (`tdExportCSV`). No completion-rate trends, average score, time-to-complete, per-question difficulty, or "who's falling behind" view for managers.
9. **No question banks / randomization.** Every learner sees the identical quiz in the identical order — fine for a 10-person crew, a real gap if this is meant to "compete."
10. **No accessibility pass done or verified** — captions/transcripts for video, keyboard navigation through the lesson pager, screen-reader labeling on the quiz inputs. Not confirmed either way; needs an explicit check.
11. **SCORM export doesn't exist.** Nothing turns a Hub-authored course into a downloadable, standards-compliant SCORM zip. This is the other half of "true SCORM compliance" and is entirely new work — see §5, Phase 4.

---

## 4. What NOT to touch (already good — this is the "don't lose it" list)

- `trh_*` career-path/certification framework end to end — permissions, versioning, audit, sign-off workflow.
- Ready-to-Start server-side paid-time capture and payroll export.
- Quick Scoop refresher/audience-targeting engine.
- The SCORM runtime's core idea (dual shim for same-origin vs cross-origin hosting) — correct architecture, just duplicated and unvalidated; consolidate, don't replace.
- Gamification (points/badges/leaderboard) and auto-assign rules — genuinely nice touches, keep as-is.
- The manager-gated `scorm-upload` edge function — solid, folder-structure-preserving, keep.

---

## 5. Concrete build plan, phased

### Phase 1 — Foundation (fix what's silently broken before building more on it)
1. **Fix the long-answer grading bug.** Either (a) exclude long-answer questions from the pass/fail calculation entirely and label them "reviewed, not scored" in the UI, or (b) require a manager to grade long-answer responses before the attempt counts as passed (matches the existing "written quiz answers" reviewer view already in `tdEmpRender`, line 688). Recommend (b) — the review UI already exists, it just isn't wired to gate the score.
2. **Reverse-engineer and document the Layer 1 schema.** Read-only introspection against live Supabase (`information_schema.columns` for `learning_paths`, `lp_courses`, `lp_course_completions` and any other `lp_*` tables), write it up as `lp_courses_SCHEMA.sql` (documentation-only `create table if not exists` matching live reality, safe to check in without touching prod).
3. **De-duplicate the SCORM upload/unzip logic** into one shared function both `js/01_part01.js` and `js/22_training_hub.js` call, instead of two copies.
4. **Server-sync video watch-progress.** Small new table (`lms_video_progress: employee_id, video_key, watched_seconds, duration_seconds, updated_at`) + a tiny upsert RPC, called from the existing `timeupdate` handlers instead of (or alongside) `localStorage`.

### Phase 2 — Real authoring experience
1. Replace the `---`-textarea page editor with a block-based editor (text block, image block, video block, file block, quiz block) — reasonable to build with `contenteditable` regions + a toolbar rather than pulling in a heavy WYSIWYG dependency, keeping in the spirit of the rest of the Hub (vanilla JS, no framework).
2. Inline image embedding within lesson text (not just materials-below-the-fold).
3. Course preview mode for managers before publishing (render exactly what a learner would see, from the draft state).
4. Question banks: tag quiz questions, optionally draw N at random per attempt.

### Phase 3 — Assessment & analytics
1. Manager analytics view: completion rate over time, average score, average time-to-complete, per-question miss-rate, at-risk trainees (assigned but stalled).
2. Auto-generated completion certificates (PDF) on course/path completion — reuse whatever PDF pipeline the rest of the Hub already has (check the existing Apps Script / PDF pattern referenced in the evaluations plan doc, `G_URL`) rather than adding a new one.
3. Additional question types: true/false, matching, ordered ranking.

### Phase 4 — True SCORM compliance
1. **Manifest-driven import.** Parse `imsmanifest.xml` for title, version, and the real launch file per `<organization>`/`<item>`, instead of guessing. Support multi-SCO packages properly (a course = multiple launchable SCOs with an aggregate completion rule).
2. **SCORM export.** Package a Hub-authored course (pages + quiz + video reference) as a self-contained SCORM 1.2 and/or 2004 zip: generate `imsmanifest.xml`, wrap the existing lesson renderer + the *existing* `window.API`/`API_1484_11` shim pattern (already built for import — same shim works for export, it just needs to run inside the exported package instead of inside the Hub) into static HTML/JS, bundle any referenced media, zip it client-side (JSZip is already a dependency) and offer it as a download.
3. **cmi5/xAPI support** as a stretch add-on once SCORM export is solid — same manifest-generation muscle, different statement format.

---

## 6. Verification steps + risks

- **Schema work (Phase 1.2) is READ-ONLY** against prod — pure introspection, zero risk, but must happen before any Phase 2+ column additions to `lp_courses` (e.g., for question banks) so those additions are based on the real live shape, not assumption.
- **Grading-bug fix (Phase 1.1) changes pass/fail behavior** — any in-flight long-answer-only quiz attempts should be reviewed for what "passed" actually meant before the fix; flag existing `passed=true` rows where the underlying quiz was all-long-answer so a manager can spot-check them if desired.
- Every new RPC added in any phase goes into `rpc_manifest.json` in the same commit (pre-deploy check enforces this).
- Test each new/changed RPC on `test_admin` / `test_crew` (PIN 1111) before deploy — confirm the forbidden-role path still throws `forbidden`, not a type error (today's bug class).
- SCORM export (Phase 4.2) should be validated against at least one real third-party SCORM Cloud/LMS test import before calling it "true compliance."
- Video progress migration (Phase 1.4): ship server-sync as ADDITIVE alongside `localStorage`, don't rip out the local fallback immediately — keeps it working offline/pre-migration.

---

## 7. Needs Issac's input before building

1. **Sequencing** — build in the order above (foundation → authoring → assessment → SCORM export), or reorder based on what's most visible/urgent to you or your managers?
2. **Rich editor scope** — comfortable with a lightweight custom block editor (matches the rest of the Hub's vanilla-JS style, no new heavy dependency), or is a specific bar in mind (e.g., "as good as Google Docs")?
3. **Certificates** — is there an existing PDF template/branding to match (the evaluations plan doc references an Apps Script `G_URL` PDF pipeline elsewhere in the Hub — reuse that look)?
4. **SCORM export priority** — real external customers/partners waiting on this, or is it more "future-proofing"? Affects whether Phase 4 moves up.
5. **Existing placeholder course content** — who's supplying real lesson text/video to replace the demo content flagged in `MASTER_CHECKLIST.md`, and on what timeline?

---

## 8. Rough effort + phasing

Matches this repo's own established cadence (own-pass project, multi-session):

- **Phase 1 — Foundation.** Grading-bug fix, schema documentation, SCORM upload de-dup, server-synced video progress. *~1 session.*
- **Phase 2 — Authoring.** Block editor, inline media, preview mode, question banks. *~2-3 sessions, the biggest single chunk.*
- **Phase 3 — Assessment & analytics.** Analytics dashboard, certificates, richer question types. *~1-2 sessions.*
- **Phase 4 — True SCORM compliance.** Manifest-driven import, SCORM export, optional cmi5. *~2 sessions.*

Each phase deploys, gets smoke-tested on test accounts, and gets reported back before starting the next — same shipping rhythm as the rest of this repo.
