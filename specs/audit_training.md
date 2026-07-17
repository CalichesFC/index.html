# Training / Learning-Management Audit

**Scope:** Phase 1 spot-check (commit `f8403df`), Learning Paths content reality-check, Forms & Documents link check, Crew Trainer/Learning Paths overlap check, competitor scan for Phase 2.
**Date:** 2026-07-17. **Method:** Read-only. No file was edited except this report. No production data was written; no test-account logins were performed (browser/computer-use tools were explicitly out of scope for this pass).
**Auditor confidence key:** Confirmed (verified in code/schema or live fetch) · Unconfirmed (could not verify — network/tooling limits, stated explicitly) · Reasoned (inferred from code with a stated gap in evidence).

---

## Summary

Phase 1 (`f8403df`) is solid. The long-answer auto-pass bug is genuinely fixed via a clean, additive `lp_pending_reviews` queue; the manager review UI (`tdReviewsHtml`/`tdReviewDecide`) reads and decides correctly; video-progress sync is a sensible greatest-wins server mirror that doesn't disturb the existing `localStorage` fallback; and the SCORM upload de-duplication is a real consolidation (not just a wrapper) that actually upgraded the weaker of the two old copies. The new SQL correctly uses `v_uid bigint` throughout, avoiding the exact bug class fixed in the immediately-preceding commit. I found one Medium-confidence logic question worth verifying (path-completion flag on review approval — see High-priority issues) and a couple of small UX gaps (rejected-review feedback isn't surfaced to the employee). Nothing here rises to Blocker.

The real launch risk in this area is unchanged from what the project's own `MASTER_CHECKLIST.md` already says: **Learning Paths has zero real content.** Every course/path visible today is explicitly-labeled sample/demo material. This was already known and already tracked (blocked on Issac supplying real content) — my audit corroborates it independently and adds one new finding (a "Reset progress" feature the help text promises does not exist in code).

Forms & Documents: of ~20 external links, I could positively confirm ~11 are live and correctly labeled via content fetch. The one link the app already flags as broken ("PandaDoc Form — needs a label/confirm link") I could not add new technical signal on — PandaDoc's eform pages render identically (a content-free shell) for both real and deliberately-invalid IDs, confirmed by testing a bogus UUID as a control. I found two additional links (Company Credit Card Policy, AFP Order Form) that both return blank content and both use a per-recipient JotForm "Sign invite" URL — plausibly wrong for a persistent shared link regardless of whether they're currently "broken" per se.

Crew Trainer and Learning Paths do not conflict in code — confirmed via distinct RPC families and no shared tables. Interestingly, the original design doc (`training_hub.sql`) planned for Crew Trainer to eventually merge into the certification engine; what shipped instead is a fully separate, simpler system. Not a bug, but worth a decision from Issac.

---

## Blockers

### B1 — Learning Paths has no real content (flagship training feature is 100% placeholder)
**Confidence:** Confirmed via code + independently corroborated by the project's own tracking doc. Live row-level content in `lp_courses`/`learning_paths` is **unconfirmed** (see Method note below) but the evidence for "placeholder" is strong enough not to need it.

- `index.html:1730-1732` (What's New modal, "Learning Paths (sample)" section) says outright: *"This is a **sample** to walk the flow — the **wording is placeholder**. Tap Reset progress to run it again."*
- `MASTER_CHECKLIST.md:38-40` (dated 2026-07-09, independent of this audit) already lists: *"Replace the Learning Path sample wording. The training Learning Paths are a working demo with placeholder lesson text. When you give me real course content, I'll swap it in (**the engine itself works**)."*
- Both sources agree the **engine** (catalog, quiz, video, gamification, now the review queue and video-progress sync) is sound — it's purely a content-population gap, not an engineering one.
- **Live-data verification attempted and blocked by tooling, not by RLS:** the sandbox's shell has no network egress at all (curl to both `ikgbihwkqhsfahnswfbz.supabase.co` and `google.com` returned connection failures — `http_code=000`). The one available networked tool (`mcp__workspace__web_fetch`) does reach the internet (used successfully for the Forms & Documents checks below) but has a hard URL-length cap that a Supabase anon JWT passed as a query parameter exceeds, and it does not support custom headers, so an authenticated REST read of `lp_courses`/`learning_paths` was not possible with the tools available this session. **Recommend:** re-run the exact `curl .../rest/v1/lp_courses?select=*` command from a machine with normal network access to get the real row count/titles for a final go/no-go call.
- **Why this is a Blocker specifically for the training feature:** an app can't credibly bill a "Learning Paths" tile to real crew as a certification path when every course is demo copy. It is **not** a blocker for the rest of the Hub (scheduling, forms, inspections, etc. are unaffected and can launch on schedule) — recommend treating this as a scoped decision: either get real content in before crew-facing launch, or gate the tile (manager-only / "coming soon") until it's ready, rather than holding the whole 30-day plan hostage to it.

---

## High-priority issues

### H1 — Two Forms & Documents links use a per-recipient JotForm "Sign invite" URL, not a shareable link
**Confidence:** Reasoned (structural concern) + Confirmed (both return blank content via fetch).

- **Company Credit Card Policy** — `index.html:2130` — `https://www.jotform.com/sign/261595768194070/invite/01ktpvs3tk085d6d5bd7f9bbf6`
- **AFP Order Form** — `index.html:2144` — `https://www.jotform.com/sign/261585890534063/invite/01ktm9zpb5ede557e6373abaae`
- Both returned completely empty content via `web_fetch` — identical in shape to a deliberately-invalid control URL I tested (`form.jotform.com/000000000000000`, also blank), whereas every ordinary `form.jotform.com/<id>` link in the list (9 of them) returned full, correctly-labeled form content. That contrast is suggestive but **not conclusive** — I had no positive control for the `sign/.../invite/...` pattern specifically, so I can't fully rule out "this is just how Sign invites always look to an anonymous fetch."
- **The structural issue stands regardless of live/dead status:** JotForm Sign "invite" links (`/sign/<formId>/invite/<token>`) are designed to be emailed to one named recipient for one signature request — not published as a standing link for an arbitrary rotating audience of staff. Even if it works today, it may silently break the next time someone other than the original invitee opens it, or after first use.
- **Recommend:** Issac (or whoever manages JotForm) open both from a phone, confirm they load for someone who is not the original named recipient, and if not, swap for JotForm's normal reusable share link (or convert off the Sign product if e-signature isn't actually required for these two).

### H2 — Review-approval may prematurely mark a whole learning path "completed"
**Confidence:** Reasoned — plausible bug, not confirmed, because the RPC it's being compared against isn't in the repo.

`app_lp_review_decide` (`lp_review_queue.sql:156-166`), on approval, unconditionally does:
```sql
update public.lp_enrollments
   set status = 'completed'
 where employee_id = r.employee_id and path_id = r.path_id and status <> 'completed';
```
This flips the **whole path's** enrollment to `completed` the moment **any one** course in it is approved via review — with no check for whether the path has other, still-incomplete courses. By contrast, the existing (untouched) `app_lp_complete` RPC appears to do real per-path counting: the frontend's own result screen (`js/08_availability.js:643`, `lmsResult()`) computes `pathDone` from `info.path_total`/`info.path_done` that `app_lp_complete`'s response supplies — implying that RPC counts remaining courses before treating a path as done, rather than blanket-marking it. `app_lp_complete`'s body isn't in any checked-in SQL file (same undocumented-schema situation as the rest of Layer 1 before `lp_courses_SCHEMA.sql`), so I could not directly compare the two and confirm this is actually a divergence rather than matching behavior.
- **Practical blast radius if it is a bug:** narrow — only affects a path that mixes an all-long-answer course with other courses, where the reviewed course happens to get approved before the employee finishes the rest. The employee-facing "certification earned" banner is computed independently client-side from `passed_course_ids`, so it wouldn't be fooled — but the **manager-facing** Team Development roster and CSV export (`tdTeamHtml`/`tdExportCSV`, which read `lp_enrollments.status`) could show a path as done when it isn't.
- **Recommend:** confirm `app_lp_complete`'s actual logic (introspect live via `pg_get_functiondef`) and, if it does real per-path counting, patch `app_lp_review_decide` to match instead of blanket-setting `completed`.

---

## Missing / incomplete features (real content vs. placeholder)

This directly answers scope item 2.

| Area | Real or placeholder? | Evidence |
|---|---|---|
| Learning Paths course/quiz/lesson content | **100% placeholder**, by the app's own admission | `index.html:1732` + `MASTER_CHECKLIST.md:38-40` (both explicit) |
| Learning Paths *engine* (catalog, quiz grading, video gate, gamification, review queue, video-progress sync) | **Real**, working, and — per this audit — sound | Direct code read, this pass |
| Training Hub (`trh_*`) career paths (Blue Apron, Shift Leader, etc.) | Framework is real and well-built per the plan doc's own assessment (`PLAN_scorm_training_topTier.md` §4, "don't touch — already good") — **not independently re-verified this pass**, out of this audit's stated scope | `training_hub.sql` seed data (§5) exists; content depth not checked |
| "Reset progress" button for the sample path | **Missing** — promised in `index.html:1732` copy, zero matches anywhere in `index.html` or any `js/*.js` file for any reset-progress implementation | Repo-wide grep, zero hits |
| Crew Trainer coaching → certification integration | **Not built**, and per `training_hub.sql:42,1071-1072` comments, was originally *planned* to eventually be a `trh_paths` row; what shipped is a fully separate ad-hoc logger | See Crew Trainer section below |

---

## Phase 1 spot-check detail (scope item 1)

Read: `js/08_availability.js` (`lmsSubmitQuiz` ~L596, `lmsSubmitForReview` L613-620, `lmsReviewPendingScreen` L621-626, `tdReviewsHtml` L682-695, `tdReviewDecide` L696-704, video-progress helpers L521-548), `lp_review_queue.sql`, `lp_video_progress.sql`, `js/01_part01.js` (`scormUploadPackage` L734-771, `lmsScormDoUpload` L772-782), `js/22_training_hub.js` (`trhScormUpload`/`trhScormDoUpload` L793-815).

**Confirmed working end-to-end, as expected:**
- An all-long-answer quiz (`gradable===0 && qs.length>0`, `js/08_availability.js:600`) routes to `lmsSubmitForReview` → `app_lp_submit_review` → `lp_pending_reviews` (status `pending`), **not** auto-passed. A quiz with at least one auto-gradable question still grades normally, unaffected — matches the plan's explicit "100% additive" claim.
- Manager review queue (`tdReviewsHtml`) correctly lists pending reviews with the employee's actual written responses, gated to manager/admin/lead/owner/VP/office roles server-side (`app_lp_review_list`, `lp_review_queue.sql:109-111`). Approve writes the same two rows (`lp_quiz_attempts` + `lp_course_completions`) the normal completion path writes, so an approved review is indistinguishable from a normal pass.
- Resubmission after a "send back" correctly creates a fresh `pending` row rather than colliding with the old rejected one (the `UPDATE ... WHERE status='pending'` won't match a rejected row, so it falls through to `INSERT`).
- Video progress: throttled 8s client push (`lmsSyncVideoProgress`), `greatest()`-merge on the server (never regresses progress), and on load the client only overwrites `localStorage` if the server value is *larger* (`js/08_availability.js:530-531`) — correctly additive to the existing device-local tracking, exactly as planned.
- SCORM de-dup is real, not cosmetic: both call sites (`js/01_part01.js:777`, `js/22_training_hub.js:811`) now call the one shared `scormUploadPackage()`. The consolidation is a strict improvement — the Training Hub copy previously skipped deploying `scorm-player.html` alongside uploaded packages (comment at `js/01_part01.js:719-727`), meaning Training-Hub-attached SCORM content never actually got a working `window.API` shim for cross-origin completion tracking before this fix.
- Script load order (`index.html:2168,2189`) puts `01_part01.js` before `22_training_hub.js`, so `scormUploadPackage` is defined before anything could reference it.

**Minor gaps found (none blocking):**
- **[Medium]** See H2 above (path-completion flag on review approval).
- **[Low]** `review_note` (manager's written reason for a "send back") is plumbed in the RPC (`app_lp_review_decide` accepts `p_note`, `app_lp_my_reviews` returns it) but is dead on both ends: `tdReviewDecide` (`js/08_availability.js:696-704`) never collects or sends a note — its "Send back" button only fires a `confirm()` dialog, no text input — and even if it did, no frontend code anywhere renders `review_note` to the employee. A rejected employee just sees their course silently revert to "Not started" with zero explanation of what to fix.
- **[Low, by design]** Only *all*-long-answer quizzes route to review. A mixed quiz (e.g., 4 multiple-choice + 1 long-answer) scores/passes on the gradable questions alone; the long-answer response is stored in `responses` but never reviewed by anyone. This matches the commit's explicitly stated scope, so it's not a regression — just a residual gap worth tracking if managers start building mixed quizzes assuming written answers are always read.
- **[Informational, not a bug]** `app_lp_review_decide`'s `insert into lp_course_completions ... on conflict do nothing` (`lp_review_queue.sql:160-162`) has no matching unique constraint on that table per `lp_courses_SCHEMA.sql`, so the clause is currently inert — harmless, and it mirrors the equally-unconstrained insert pattern the existing `app_lp_complete` uses, so it's consistent rather than broken.
- **[Very low, pre-existing app-wide pattern]** `lmsSubmitForReview`'s `withPin()` call omits the cancel callback, so if the cached PIN happens to expire at that exact moment, "Submitting for review…" could sit on screen with no error feedback. This pattern is used throughout the app (not unique to this change), so it's not a new regression.

---

## Forms & Documents check (scope item 3)

Checked all ~20 external links in `index.html:2102-2153` via live fetch (network-capable tool; the sandbox shell itself has no egress — see Blocker B1 method note).

**Confirmed live, correct content matches label:**
Weekly Schedule Submission, Change of Address Request, New Employee Info Form, Payroll Report, Raise Eligibility Checklist, Internal Incident Report, Leadership Role Alignment & Growth Reflection, Admin Assistant Internal Application (all JotForm), New Manager Email Request (onpointlc.com), Hiring Paperwork Uploads (pCloud — title matches), Caliche's Website.

**Flagged, needs attention (H1 above):** Company Credit Card Policy, AFP Order Form — both JotForm Sign invite links, both return blank content.

**Already known, no new signal added:** "PandaDoc Form (needs a label / confirm link)" (`index.html:2132`) — already tracked in `MASTER_CHECKLIST.md:23-24` as a 🔴 needs-you item. I fetched it; it returned PandaDoc's generic content-free `eForm` shell. I also fetched a **deliberately invalid** PandaDoc eform UUID (`00000000-0000-0000-0000-000000000000`) as a control and it returned the **byte-identical** shell — proving PandaDoc's static page can't distinguish a valid ID from a bogus one (the real form renders client-side after a JS validity check). So this method genuinely cannot add signal here; it remains exactly as unresolved as the app already says.

**Unconfirmable via static fetch (not flagged as broken — just can't be checked this way):** the other 4 `eform.pandadoc.com` links (W-4/I-9, Direct Deposit, Employee Application, Fundraiser Program Info) and the `form.pandadoc.com/form/...` link (Fundraiser Receipt) and the Dropbox share-folder link (Onboarding Paperwork) — confirmed by testing bogus control URLs on both the PandaDoc-Forms-product domain and Dropbox's share-link domain and getting equally content-free responses for definitely-fake URLs. These domains are pure client-rendered SPAs with no server-exposed existence check. **Recommend:** a quick manual click-through pass (this audit deliberately did not use browser automation, per the task's scope reservation).

**Polish:** the "Weekly Schedule Submission" JotForm's own internal document title is the generic default "Smart PDF Form" (visible in browser tab / social-share previews, not inside the Hub) — content is correct, just an unlabeled JotForm-side title. Also noted: the list mixes two different PandaDoc URL shapes (`eform.pandadoc.com/?eform=<uuid>` vs `form.pandadoc.com/form/<slug>`) — not necessarily wrong, worth a consistency pass.

---

## Crew Trainer overlap check (scope item 4)

Read: `js/10_my_maintenance_submissions.js:579-671` (`openCrewTrainer`, `crewTrainerTab`, `ctLoadMine`, `ctOpenCoach`, `ctSaveCoach`, `ctLoadManage`, `ctAssign`, `ctEnd`), `training_hub.sql` (design comments), `rpc_manifest.json`.

**Confirmed: no functional conflict.** Crew Trainer runs on its own RPC family (`app_trainer_assign`, `app_trainer_assignments`, `app_trainer_end`, `app_trainer_signoff` — all four registered in `rpc_manifest.json`) that is architecturally distinct from both `app_lp_*` (Learning Paths) and the `trh_*`/`app_trh_*` Training Hub certification engine (`js/22_training_hub.js`). No shared tables, no shared RPC, no evidence of double-writes. This matches the What's New copy's own claim (`index.html:1728`): *"This logs that coaching was delivered — a training note, kept separate from a competency certification."* Confirmed accurate.

**Worth Issac's attention (Medium, informational, not a conflict):**
- `training_hub.sql:40-43` and `:1071-1072` show the *original* design explicitly planned for Crew Trainer to later become a `trh_paths` row: *"Warehouse/Fulfillment, Maintenance, future Corporate, later Crew Trainer... Crew Trainer is intentionally NOT seeded — adding it later is just a new `trh_paths` row."* What actually shipped is a standalone, simpler coaching-note logger with its own schema, not a `trh_paths` entry. This is a safe design (zero collision risk, confirmed above) but means coaching delivered through Crew Trainer currently contributes to **no** certification, path progress, or passport record anywhere — worth confirming that's still the intended long-term shape, since the original comment suggests otherwise.
- Whatever table(s) back `app_trainer_assignments`/`app_trainer_signoff` have **no checked-in migration file anywhere in the repo** (grepped all `*.sql`, zero hits) — the same undocumented-live-schema gap Layer 1 had before `lp_courses_SCHEMA.sql` closed it. The RPC *names* are governed (all 4 in `rpc_manifest.json`), but column shapes are not. Recommend the same reverse-engineer-and-document treatment Phase 1.2 gave Layer 1.

---

## Stale-content candidates

1. **API_REFERENCE.md's own location pointer is stale.** It states the anon key lives "in `index.html` (~line 2575)" (`API_REFERENCE.md:36`). A full-file grep of `index.html` for `supabase.co`/`createClient`/the key itself returns **zero matches** — `index.html` is currently only 2509 lines and doesn't contain it at all. The key actually lives in `js/01_part01.js:3-5`. Minor, but this doc bills itself as "the don't break it map," so a wrong pointer is worth a one-line fix.
2. **"Reset progress" feature referenced in What's New copy does not exist in code** (see Missing/incomplete features table above).
3. **Terminology mismatch in help copy:** `index.html:1732`'s "Learning Paths (sample)" text uses *"White Apron, Register Certification…"* as example path names — but "White Apron" is specifically Training Hub / Crew certification terminology (`training_hub.sql:51`, `js/22_training_hub.js:5-7`, `app_settings` key `trh_white_apron_label`), a different system from the Layer 1 "Learning Paths" catalog the help text is describing. Could not confirm from the live `learning_paths` table (network-blocked, see B1) whether the actual seeded sample path is coincidentally also named "White Apron" or whether the help text is just reusing the term loosely. Recommend Issac spot-check that the help copy's example names match what a user actually sees in the live Learning Paths catalog.

---

## Competitor-inspired ideas (feed into Phase 2 planning)

Researched TalentLMS, 360Learning, and Trainual (current 2026 feature sets), plus frontline/QSR-specific microlearning platforms (Axonify, eduMe, Operandio), and sanity-checked against `PLAN_scorm_training_topTier.md` §5 Phase 2 (block-based editor, inline images, preview mode, question banks).

1. **AI-assisted "draft from an existing document" course generation** — TalentLMS's TalentCraft, 360Learning's AI Content Builder, and Trainual's AI drafting all now let a manager feed in an existing PDF/Word doc and get a structured lesson+quiz draft back, rather than starting from a blank editor. This is arguably **higher-leverage than the block editor alone** for this specific app's actual problem: the real bottleneck behind the placeholder-content gap (Blocker B1) is almost certainly "nobody has time to write lessons from scratch," not "the textarea editor is unpleasant." The Hub already has an AI chat widget (`js/12_ai_chat_widget.js`, "Ask Mr. Scoopy") and an existing Apps Script pipeline (`G_URL`, per `API_REFERENCE.md:39`) that could plausibly be extended for this rather than standing up a new integration. Recommend pulling this into Phase 2 rather than treating it as a stretch goal — it directly attacks the launch blocker.
2. **Reusable role-based starter templates** — Trainual's biggest differentiator for non-technical managers is 500+ prebuilt templates plus training organized around *roles* rather than one-off courses. The Hub already has the right primitive for this (`lp_assignment_rules` auto-assign-by-role engine) — pairing it with a small starter library of QSR-relevant content (food safety basics, register walkthrough, cleaning/closing checklist) would put *some* real content in front of crew on day one instead of nothing, while real custom content gets built out.
3. **Keep new lesson content short by design (2-7 minute chunks) + lean on spaced repetition** — frontline-specific research (Axonify, eduMe) is unanimous that short, spaced microlearning beats long-form lessons for high-turnover crews. The Hub's existing **Quick Scoop** feature (Layer 3, per the plan doc) is already exactly this pattern — recommend explicitly designing new Learning Paths content in short chunks and cross-promoting Quick Scoop as the "spaced repetition" layer rather than treating the two as unrelated features.
4. **Auto-generated PDF completion certificates + a manager "at-risk learner" analytics view** — validated by this research as genuinely table-stakes for "top tier" (Docebo, TalentLMS both treat this as core, not a bonus). This is already correctly scoped as Phase 3 in the existing plan (gap #7, #8) — recommend not letting it slip behind Phase 2's editor work, since competitors ship it as baseline.
5. **Let non-admin trainers/shift-leads draft content, gated by a manager publish step** — 360Learning's core differentiator is subject-matter-expert co-authoring with a review/approval loop, not one L&D person authoring everything. The Hub's existing draft/publish plumbing (`pub_status: draft|published`, `app_lp_set_status`) already has the mechanics for this. Widening *who* can hit "save as draft" (not just admins) would directly attack the root cause of Blocker B1 by spreading the authoring workload beyond a single manager's spare time.

`PLAN_scorm_training_topTier.md`'s Phase 2 scope (block-based editor via `contenteditable` + toolbar, no heavy framework) is a reasonable, consistent-with-the-rest-of-the-Hub technical approach and matches what I saw in the actual codebase (JSZip is the only heavy dependency already in use). My one addition: idea #1 above (AI-assisted drafting) isn't currently in the Phase 2 plan at all and, based on this competitor scan, is probably the single highest-leverage addition to make to that phase.

---

## Test records created

**None.** This audit was entirely read-only: static code/schema reading plus `WebFetch` calls against already-public external form URLs (JotForm/PandaDoc/Dropbox/pCloud/caliches.com — none of which touch Caliche's Supabase data). No test-account logins were performed, no RPCs were called, no rows were inserted or modified, and no file other than this report was written.

---

## Open questions for Issac

1. **Real Learning Paths content** (Blocker B1) — already queued in `MASTER_CHECKLIST.md` as a 🔴 needs-you item. What content can you provide and on what timeline, and should the Learning Paths tile be soft-launched (manager-only / "coming soon") if real content isn't ready inside the 30-day window?
2. **The already-flagged "PandaDoc Form (needs a label / confirm link)"** — what's the correct name and URL? (Restating the existing `MASTER_CHECKLIST.md` ask since it's directly in this audit's scope; this pass added no new technical signal on it.)
3. **Company Credit Card Policy and AFP Order Form** (H1) — both use JotForm's per-recipient Sign-invite link type. Can you confirm from a phone, logged out, that both still open for someone other than the original named signer? If not, they need to be swapped for reusable links.
4. **"Reset progress"** — is this a feature you still want for the sample Learning Path (it's promised in the What's New help text but doesn't exist in code), or should that line just be removed from the copy?
5. **Crew Trainer's long-term shape** — should coaching notes eventually feed into the Training Hub certification engine (matching `training_hub.sql`'s original "future Crew Trainer = a `trh_paths` row" design comment), or is keeping the two fully separate (today's shipped behavior) the intended permanent design?
6. **Mixed quizzes** (some auto-graded + some long-answer questions) — should the long-answer portion also route to manager review in a future pass, or is skipping review whenever at least one question is auto-gradable acceptable?
7. **Review-approval path-completion flag** (H2) — worth a quick live check (introspect `app_lp_complete`'s actual SQL body) to confirm whether `app_lp_review_decide`'s blanket "mark path completed" on a single course approval matches or diverges from normal completion behavior.
