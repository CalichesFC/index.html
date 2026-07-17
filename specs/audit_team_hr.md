# Audit — Team Growth & HR-Sensitive Workflows

**Auditor:** Claude (read-only code + SQL trace)
**Date:** 2026-07-17
**Scope:** Employee Roster, Disciplinary Actions, PIPs, Attendance & Call-outs, Report-a-Concern (confidential), Team Growth & Evaluations (compliance dashboard + 4 corp reports + per-store rollups + promotion/pay-proposal queue), Crew Trainer, Celebrations/Recognition/Shout-outs, Sick Leave, Manager Logbook, Pay Tools.
**Files traced:** `index.html`, `js/04_employee_roster.js`, `js/05_admin_tasks_pip_disciplinary.js`, `js/06_disciplinary_actions.js`, `js/07_assignable_tasks_messaging.js`, `js/08_availability.js` (Your Voice), `js/10_my_maintenance_submissions.js` (Crew Trainer), `js/12_ai_chat_widget.js` (Sick/Logbook), `js/17_team_growth.js`, `js/25_payraise_deltas.js`; SQL: `team_growth.sql`, `team_growth_finish.sql`, `tg_finish.sql`, `payraise_deltas.sql`, `payraise_adjust.sql`, `employee_passport.sql`, `passport_phase2.sql`, `employee_readiness_report.sql`, `phase4_5_autosched_logbook.sql`, `rpc_manifest.json`.

---

## Summary

The Team Growth / Evaluations module is in good shape and its permission model is **verifiable and correct where the SQL is present**: the recently-fixed corporate reports and dashboard (`app_tg_corp_dashboard`, `app_tg_report_evals/certs/growth/recognition`) all gate on `_tg_is_corp(role)`, which resolves to `%admin%`/`%owner%`/`%VP%`/`%president%` and **correctly excludes store managers and shift leads**. Pay-proposal and promotion **decisions** require `_tg_is_corp`; drafting/reading uses `_tg_is_mgr`; employees see only their own via `_pp_is_self`. Frontend gates (`tgIsCorp()`) match the backend. Role-change on the roster properly requires an effective date + reason and writes an employment-history + audit event. All **542** unique RPC names called by the frontend (direct + wrapper) exist in `rpc_manifest.json` — no orphan/typo'd calls.

**However, this section touches confidential HR data, and I found two confirmed/again-likely confidentiality problems plus one authority inconsistency that must be resolved before launch** (details below).

### Important method limitation — live testing was NOT possible
I have a shell, but this sandbox has **no network egress to Supabase**: the outbound proxy returns **HTTP 403 Forbidden** on `CONNECT ikgbihwkqhsfahnswfbz.supabase.co:443`, and the only working fetch tool is GET-only and rejects the long anon-key URL. So I could **not** run the recommended `curl` permission tests (e.g., "confirm `test_crew` gets *forbidden*"). **No test records were created; nothing was modified.**

Compounding this: the **SQL source for most core HR RPCs is not in the repo** (the repo SQL is "history, not the live truth," per `API_REFERENCE.md §7`). Specifically, **no source is present** for `yv_*` (the live Report-a-Concern system), `app_harassment_*`, `app_discipline_*`, `app_pip_*`, `app_attendance_*`, `app_recognition_*`, `app_sick_*`, `app_trainer_*`, `app_emp_promote`, `app_emp_set_wage`, or `app_roster_*`. Their backend role-gating therefore **cannot be confirmed from available artifacts** and is marked **"Unverified — needs live click-through or a DB function dump."** I verified backend gating only for the ~40 in-scope functions whose SQL is in the repo.

---

## BLOCKERS (permission / confidentiality — resolve before launch)

### B1. Confidential "Report a Concern" visibility is broader than documented — CONFIRMED on the frontend, backend Unverified
**The documented promise** (`index.html:756`, `js/11:883`): a concern report *"goes only to Admin Managers... it is not visible to store management."*

**What actually ships.** The live concern system is **"Your Voice 2.0"** (`js/08`, tile `btn-report` → `openYourVoice`), using `yv_*` RPCs. Its reviewer surface, the **Team Voice Dashboard** (`yv2Dash` → `yv_list`; case view `yv2Case` → `yv_get`), lists **all** submissions including the `concern` pathway (categories: *Harassment, Discrimination, Safety, Retaliation, Wage/Hour, Misconduct by a leader*). The dashboard is offered whenever `yv2CanManage()` is true (`js/08:313,327`):

```
yv2CanManage() = is_developer OR isManagerRole()
isManagerRole() = role ∈ {Admin Manager, 'Manager', Vice President/Co-Owner} OR is_developer   (js/04:870)
isAdminManager()/isDiscAdmin() = role ∈ {Admin Manager, Vice President/Co-Owner} OR is_developer (admin-only)
```

So the concern dashboard is gated with **`isManagerRole()` (which includes the generic `'Manager'` role)** — **not** the admin-only `isAdminManager()`. The **legacy** concern list on the same screen is correctly gated `isDiscAdmin()` (`js/08:373`), so the new path is *inconsistent and broader* than the old one and broader than the documented promise.

**Why this is a Blocker.** If any real user has role `'Manager'` (or the backend `yv_list`/`yv_get` mirror the frontend's `isManagerRole` breadth), then non-admin/store-level management can read harassment/retaliation reports — a direct breach of the promise printed to the reporter. Confidential-data exposure is a Blocker regardless of likelihood.

**Required before launch:**
1. Change the concern-reviewer gate to **`isAdminManager()`** (match the legacy path / the printed promise). Non-concern pathways (talk/idea/feedback/help) can stay on the broader manager gate if desired — but *concern* must be admin-only.
2. **Verify the backend** `yv_list` and `yv_get` restrict `pathway='concern'` to Admin Manager / VP only (live test: sign in as a non-admin manager and confirm concerns do not appear; or dump the function bodies). **Unverified today.**

### B2. Anonymous concern reports still transmit the reporter's identity — true anonymity is backend-dependent and Unverified
`yvRpc` (`js/08:312`) **always** injects `p_username`/`p_password`, so even a submission with `anonymous:true` sends the signed-in user's identity to the server. The UI explicitly promises *"we will not record your name or who you are"* (`js/08:339,348`). Whether that promise holds depends entirely on the backend `yv_submit` **discarding** the identity when `anonymous=true` (and not linking it via a `created_by` column, the `yv_mine` list, or `audit_log`). This is **Unverified** (no SQL, no live test). Because the app makes an explicit anonymity guarantee on a harassment-reporting channel, treat any gap here as a Blocker.
**Required:** confirm anonymous rows store no submitter FK/name and never surface the reporter in `yv_get`, `yv_mine`, or audit trails.

### B3. `app_tg_proposal_adjust_list` exposes pay-rate history to ANY authenticated user — CONFIRMED in SQL
`payraise_adjust.sql:106-119` — `app_tg_proposal_adjust_list(p_username, p_password, p_proposal_id)` authenticates the caller but has **no role/self gate** (unlike its sibling writer `app_tg_proposal_adjust`, which *is* gated to management). It returns full rows from `tg_pay_proposal_adjustments`:

```
old_rate, new_rate, old_effective_date, new_effective_date, reason, adjusted_by_name, adjusted_at
```

Because PostgREST exposes every function to anyone with the (public, shipped-in-JS) anon key + any valid login, a crew member (`test_crew`) can call this with sequential `p_proposal_id` values (1, 2, 3…) and read **every employee's raise-adjustment history and dollar amounts**. Confirmed by reading the function body and by a repo-wide scan (it is the *only* in-scope function that authenticates but has no role gate).
**Fix (additive, safe):** add `if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;` after the `_pp_auth` null-check (matches the module's convention). Frontend caller is `js/25:438` inside admin-only pay tools, so adding the gate won't break the intended UI.

---

## High-priority issues

### H1. Write-Up (level `final`) can be issued by non-admin managers, contradicting the app's own "Admin Managers only" messaging
In `js/06`, only the `termination` form carries `admin:true`. The **`writeup`** card (`DISC_FORMS.writeup`, level `'final'`) has **no admin flag**, and the everyday **`written`** form's "Recommended action" radio sets `lvl='final'` when "Write-Up" is chosen (`js/06:206`). The whole Disciplinary view is gated by `isMgmt()` (which includes Shift Lead / Store Manager), while `discFillLevels` and the alert text (`js/06:133`) claim *"Final warnings and termination can only be issued by Admin Managers."* Net effect: **any management user can submit a `level='final'` write-up**, contradicting the stated rule. Backend `app_discipline_create_v2` gating is **Unverified** (SQL not in repo). If the backend also fails to restrict `final`/`termination` to admins, this is an authority bypass on a disciplinary record.
**Required:** decide the intended rule; if Write-Up is admin-only, add `admin:true` to the `writeup` form, restrict the `written` form's "Write-Up" radio for non-admins, and confirm `app_discipline_create_v2` enforces level→role server-side.

### H2. Cross-store visibility of evaluations / growth is not store-scoped
`_tg_is_mgr` and the passport gates authorize **any** manager/lead — with no store scoping — to read another employee's evaluation (`app_tg_eval_get`), growth spine (`app_tg_spine`, `_tg_is_mgr OR self`), development goals, and passport. A Shift Lead at one store can view an employee's records at another store. This is consistent across the module (so likely by design for a small chain), but for HR-sensitive records it should be an explicit decision.
**Confirm with Issac:** should managers see only their own store's people? If yes, add a location predicate to the manager branch of these reads.

---

## Medium / Low

- **M1. Two parallel concern systems; one is orphaned dead UI.** The `app_harassment_*` "Report a Concern" screen (`harassReportView` in `index.html:748`; `openHarassReport`/`harassSubmit`/`harassLoadAdmin`/`harassAssign`/`harassResolve` in `js/06:378-448`) has **no caller anywhere** — it is unreachable. The live path is Your Voice (`yv_*`). But the *legacy admin list* is still surfaced to admins via `yvLegacyLoad` (`js/08:379`, calls `app_harassment_list`), so old reports remain live-reachable. Decide: migrate legacy reports into `yv_*` and delete the dead screen, or keep the legacy read behind the admin-only toggle only. Two concurrent confidential-report backends is a foot-gun. (Also: verify `app_harassment_list` backend is admin-only — `js/06:417` and `js/08:379` pass `p_admin_username`/`p_admin_password`, but the body is Unverified.)

- **M2. Inconsistent PIN handling → dead-end / misleading errors.** Crew Trainer (`js/10:599,626,633,640,658,667`) and several roster calls (`js/04:197,244` — role change + employment history) pass `p_password: sessionPin` **directly** instead of using `withPin()`. If `sessionPin` isn't already cached, the RPC receives a null password and returns `forbidden`, which the UI reports as *"You do not have permission to change roles"* (`js/04:245`) — misleading a legitimate admin. Elsewhere (`p4Rpc`, `tgRpc`, `wobRpc`, `js/04:587,626`) the app correctly prompts via `withPin()`. Make the sessionPin call sites use `withPin()` for consistency and to avoid a false permission dead-end.

- **M3. Resolved/closed items show by default.** The Team Voice Dashboard status filter defaults to "All statuses," so Resolved/Closed concerns and completed cases render on open (`js/08:369`). Disciplinary feed shows voided actions greyed rather than hidden (`js/06:83-88`). Consider defaulting these views to open/active items and moving Closed/voided behind a toggle. `app_pip_active` (roster PIP badge) already scopes to active PIPs — good.

- **L1. Positive/OK observations (verified):** logbook (`app_logbook_add/list`, `phase4_5`) is backend `_sched_mgr`-gated ("Managers only"); the frontend's `{p_location,p_shift,p_note}` resolves cleanly to the correct overload (no arg mismatch). Crew Trainer coaching is recorded as **coaching notes** via `app_trainer_signoff` (gated to the assigned trainer) and is **structurally separate from certification** (`employee_certs` / `trh_award_cert`) — requirement met. Recognition/shout-outs correctly route non-manager posts into a **manager approval queue** (`app_recognition_pending` → `app_recognition_decide`). All three legacy HR views have a working "Back to Menu" control (no dead-ends).

---

## Missing / incomplete features

- **`app_readiness_report`** is fully defined in `employee_readiness_report.sql` (manager-gated) but is **not in `rpc_manifest.json` and is not called anywhere** in the frontend — a built-but-unwired "Employee Readiness Report." Either wire it up (add a button + manifest entry) or retire the SQL file. (It appears superseded by `app_tg_spine` / the passport.)
- **Backend source gap.** Because the SQL for the core HR RPCs isn't in the repo, the module's most sensitive permission checks can't be code-reviewed. Recommend committing a `pg_get_functiondef` dump (or the real source) for at least `yv_*`, `app_harassment_*`, `app_discipline_*`, `app_pip_*`, `app_attendance_*`, `app_sick_*`, `app_recognition_*`, `app_trainer_*`, `app_emp_promote/set_wage`, `app_roster_*` so gating is auditable and the `API_REFERENCE.md` health check can cover bodies, not just names.

---

## Stale-content candidates

1. `harassReportView` + `openHarassReport`/`harassSubmit`/`harassLoadAdmin`/`harassAnonToggle`/`harassAssign`/`harassResolve`/`harassDoUpdate` — orphaned dead UI (`index.html:748`, `js/06:378-448`). Remove or re-link deliberately.
2. Legacy `app_harassment_*` data path (`yvLegacyLoad`, `js/08:375-392`) — migrate into `yv_*` or keep read-only behind the admin toggle; don't run two confidential backends indefinitely.
3. `app_readiness_report` / `employee_readiness_report.sql` — unwired.
4. Default views include resolved/closed/voided records (M3) — candidates to archive out of the default view.

---

## Competitor-inspired ideas (evaluations / growth / confidential HR)

1. **Competency matrix + self-visible growth plan (Lattice "Grow").** The passport already stores per-station levels (Learning→Developing→Qualified→Ace→Coach). Add the *expectations text per level* so an employee sees exactly "what earns the next level" on each station, and expose a read-only growth plan on their own profile. Turns the passport from a rating into a development tool. ([Lattice Grow](https://lattice.com/platform/grow))
2. **Structured recurring 1:1 / check-in tied to the employee record (Lattice 1:1s).** You already have the Manager Logbook and Crew Trainer coaching notes; combine them into a lightweight recurring 1:1 whose agenda auto-pulls open dev goals, an active PIP, and the latest evaluation, with notes preserved on the employee timeline. ([Lattice review 2026](https://peoplemanagingpeople.com/tools/lattice-review/))
3. **Role-based auto-assignment of training/SOPs and certs (Trainual "Training Paths").** Define required content per role; when someone is promoted via `app_emp_promote`, auto-assign the new role's required certifications and crew-trainer coaching path. Closes the loop between role change, training, and the compliance dashboard. ([Trainual playbooks](https://trainual.com/solution/playbook), [Trainual 2025 updates](https://trainual.com/manual/trainual-wrapped-2025-the-product-features-and-improvements-shaping-more-productive-teams))
4. **Purpose-built confidential case management with hard role isolation (BambooHR + FaceUp / AllVoices).** Dedicated whistleblowing tools model exactly what this section needs: strict admin-only isolation, an immutable audit trail, participant tagging (raiser / subject / witness), and provable anonymity. Use them as the target spec when hardening B1/B2 — especially the pattern of tagging the *subject* of a report so a manager who is the subject can never be the reviewer. ([FaceUp × BambooHR](https://www.faceup.com/en/blog/boost-employee-engagement-bamboohr-faceup), [BambooHR compliance](https://www.bamboohr.com/platform/compliance/))
5. **Policy-acknowledgment / e-sign compliance dashboard (BambooHR compliance + Trainual quizzes).** Disciplinary forms already capture signatures and evaluations have an acknowledgment step (`app_tg_eval_ack`). Extend this into a company-wide "who has acknowledged what" view (policies, evals, PIP letters) with completion % per store — a natural addition to the existing compliance dashboard, and a real conflict-avoidance/legal safeguard. ([BambooHR compliance](https://www.bamboohr.com/platform/compliance/))

---

## Test records created

**None.** Authenticated live RPC testing was not possible from this environment: the sandbox's outbound proxy returns **403 Forbidden** on the HTTPS CONNECT to `ikgbihwkqhsfahnswfbz.supabase.co`, and the available GET-only fetch tool rejects the anon-key-length URL. No data was created, modified, or deleted. The recommended permission tests (e.g., `test_crew` → `app_harassment_list` / `yv_list` / `app_tg_proposal_adjust_list` should return *forbidden*) still need to be run from a networked machine.

---

## Open questions for Issac

1. **Does the role string `'Manager'` mean store-level management?** If yes, B1 is an active breach — the concern dashboard (`yv2CanManage`/`isManagerRole`) must drop to `isAdminManager()` immediately.
2. **Backend confirmation needed (can't test here):** Do `yv_list`/`yv_get` restrict the `concern` pathway to Admin Manager/VP only? Do anonymous submissions truly store **no** submitter identity (no FK, not in `yv_mine`, not in `audit_log`)? Is `app_harassment_list` admin-only? Is `app_tg_proposal_adjust_list` intended to be readable by non-managers (B3 says no)?
3. **Is Write-Up (`level='final'`) meant to be Admin-Manager-only?** If yes, fix the `writeup`/`written`-radio gating and confirm `app_discipline_create_v2` enforces level→role.
4. **Cross-store visibility (H2):** should managers see only their own store's evaluations/growth, or company-wide as today?
5. **Can you commit the SQL source (or a `pg_get_functiondef` dump) for the un-sourced HR RPCs** so their gating can be audited and kept in sync?
6. **Retire the orphaned `app_harassment_*` "Report a Concern" screen** and consolidate on Your Voice?
