# Caliche's Hub — Pre-Launch Audit: Master Findings & Fix Plan

**Date:** 2026-07-17. **Method:** 8 parallel agents (mix of Opus/Sonnet/Fable) each did a full read-only code+SQL trace of one section of the app, cross-referenced every RPC call against `rpc_manifest.json`, and researched named competitors. Full reports are in `specs/audit_*.md` (index at the bottom). This document is my consolidation of all 8, plus one live check I ran myself.

**Important caveat that applies to almost everything below:** every agent's sandbox had zero network access to Supabase, so **nothing was live-click-tested**. Everything is code-trace-confirmed, not behavior-confirmed. I've marked the highest-stakes unverified items in the checklist in §4 — please run those before we touch code. This isn't a weakness in the findings (the code reading was extremely thorough, and several things were confirmed via direct SQL/doc evidence), it just means "the code says X will happen" hasn't been watched happening yet in a couple of the scariest cases.

---

## 0. One thing I verified myself, live, just now

You asked specifically whether catering invoices are actually taking payment. I logged into your Supabase dashboard (already-authenticated Chrome session) and checked directly — this isn't inference, I looked at the actual screens:

- **Edge Functions → Secrets:** only the default Supabase system secrets exist. There is **no `SQUARE_ACCESS_TOKEN`, `SQUARE_ENV`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, or `SQUARE_WEBHOOK_URL`.** None have ever been set.
- **Edge Functions list:** both `square-invoice` (deployed 4 days ago) and `square-webhook` (deployed 11 days ago) exist and are live-deployed.

**Plain answer: no, Square is not taking real payments right now, full stop.** The code is completely built and both functions are deployed, but with no access token, no pay link can even be generated, and with no webhook signature key, nothing could ever auto-confirm as paid even if it were. Today, "Paid" only happens when a manager manually clicks **Mark Paid** and types in what the customer told them — and once that happens, **yes, a real receipt is visible in the Hub** (amount, date, method, reference, itemized, printable) via the Receipt button on the quote. That part works. Setting up real Square payments is a ~30-minute task following `SQUARE_INVOICE_SETUP.md` §H whenever you're ready — it's not a code problem, it's three secrets and a webhook registration.

---

## 1. Blockers (fix before launch, roughly in priority order)

### Security / confidentiality
1. **Any crew member can read anyone's pay-raise history.** `app_tg_proposal_adjust_list` has no role check at all — confirmed by reading the SQL. A curious employee could pull every coworker's raise amounts and reasons just by guessing proposal IDs. *(audit_team_hr.md, B3 — one-line fix, high confidence)*
2. **"Report a Concern" may be visible to more managers than promised.** The app tells reporters a concern "goes only to Admin Managers... not visible to store management." The actual reviewer screen is gated to the broader `isManagerRole()` (includes plain "Manager"), not the admin-only check the legacy version correctly uses. Backend enforcement is unverified. *(audit_team_hr.md, B1)*
3. **Anonymous concern reports may not actually be anonymous.** The submit call always sends your logged-in identity to the server; whether the backend discards it when "anonymous" is checked is unverified. Given the app explicitly promises anonymity on a harassment-reporting channel, this needs a direct answer, not an assumption. *(audit_team_hr.md, B2)*

### Safety
4. **Emergency Procedures has literal blank phone numbers.** "Call the manager on call: [____]" — live on production right now, confirmed by fetching the deployed site directly. This is pure data entry (6 fields in Business Settings → Emergency Numbers), not a code fix, and is a same-day close. *(audit_content_stale.md, B1 — exact field list included)*

### "Can't go back / stuck" — the exact thing you flagged
5. **The "confirm your schedule" screen can trap someone with no way out**, including blocking Time Clock access, if the confirm click fails for any reason (expired session, WiFi blip). No close button, not covered by the app's own "dismiss a stuck screen" logic. *(audit_scheduling.md, B1)*
6. **Anyone with the `Maintenance` role gets stuck the moment they log in.** They land straight on a retired screen that no longer receives real repairs, can't reach the main menu, and their only "Back" button logs them out. Compounding bug: even if they got to the real Work Orders screen, a role-name typo (`Maintenance Lead` vs. the real `Maintenance`) means they still wouldn't see their own queue. *(audit_maintenance.md, B1+B2 — please confirm what your actual maintenance techs' role is set to, this determines if it's live-broken today)*

### Fake data shown as real
7. **The "Live Dashboard" shows fabricated Square/catering numbers under a pulsing "live" indicator.** Made-up towns (Deming, Hatch, Silver City — not even your real 5 stores), made-up customer names, made-up dollar figures. Zero backing data call. One line of small gray text at the bottom is the only disclosure. This is exactly the "missing information presented as real" problem you called out. *(audit_admin_dashboards.md, Blocker #1)*

### Silently broken, already-shipped workflows
8. **Promoting someone to "Shift Leader" or "Assistant Manager" silently breaks their tool access**, because most permission checks in the code look for the string "Shift Lead" (no "er") and nothing recognizes "Assistant Manager" at all. The promotion itself succeeds and looks fine — the person just quietly loses access to Disciplinary Actions, Attendance, Pre-Shift, Pop-In, Inventory, and more. *(audit_admin_dashboards.md, Blocker #2 — worth a quick DB query to see if this has already happened to a real employee)*
9. **Six core RPCs — Clock In, Clock Out, Start Break, End Break, and the manager Approve/Deny buttons for time-off and swap requests — are invisible to every safety check in this repo** because they're built from a variable instead of a literal function name. This is the exact same bug class I found and fixed in Team Growth reports during the training deploy — it's a blind spot in the tooling itself, not necessarily broken code, but nobody would know if it were. **This is the single highest-value 60 seconds you could spend on this whole audit: click clock in/out, a break, and approve one test request.** *(audit_scheduling.md, B2)*
10. **Shift Checklists may never show items a manager adds**, because the admin editor saves "Opening" and the crew screen queries "open" — a capitalization/wording mismatch that likely means a plain equality check on the backend returns nothing. 30-second test: add a checklist item as Opening, check if it shows on the crew Opening tab. *(audit_daily_ops.md, B1)*

---

## 2. High-priority issues (grouped by theme, condensed — full detail in each report)

**Trust-breaking error handling:** Several forms (Pop-In Inspection, Vehicle Checkout, Damage Report) get permanently stuck on "Saving…" with no retry if the save fails, and Pop-In's own error message falsely claims "PDF was emailed" when nothing was — the opposite of reassuring in a real failure. *(audit_daily_ops.md, H1)*

**Dead-end / never-closes flows:** Inventory Count's "Request" button has no fulfill/close step anywhere in the code — it can only ever grow, never resolve. Three different, inconsistent "ask for supplies" systems coexist (one of them fully orphaned). Work Orders has no Cancel action despite Cancelled being a defined status. *(audit_daily_ops.md H3/H4, audit_maintenance.md H5)*

**"Looks like a safety check, isn't":** Vehicle & Trailer Check-Out's 6-item safety checklist has zero required checkboxes — a driver can submit with nothing checked. *(audit_daily_ops.md, H5)*

**Two systems that don't talk to each other, so people lose track of their own reports:** Maintenance has an old system (`maintenance_logs`) and a new one (Work Orders) that share no data — a crew member who reports a repair the "right" way has no screen anywhere that shows them what happened to it. *(audit_maintenance.md, H1)*

**Money-adjacent:** After a manual "Mark Paid," the catering pipeline doesn't auto-refresh (calls a function that doesn't exist) — the payment saved fine, the manager just has to reload to see it. Customer-side pay-link failures fail completely silently with no staff alert. *(audit_catering_payments.md, H1/H3)*

**Admin tooling gaps:** The Manager Dashboard's date-range filter is decorative — it's never actually wired to the query. Roles & Permissions can't control about a third of the real feature gates that exist in the app (including Pay Tools). A "permanently delete user" button sits next to a settings card that promises "records are archived, never hard-deleted." *(audit_admin_dashboards.md, H3/H4/H6)*

**HR:** Any management-level user can currently issue a final Write-Up, even though the app's own copy says that's Admin-Manager-only. *(audit_team_hr.md, H1)*

**Training:** Learning Paths — the flagship training feature — is confirmed 100% placeholder content today (the engine itself is solid and just shipped real improvements). Not a blocker for the rest of the app, but it can't be billed to crew as real certification yet. *(audit_training.md, B1)*

---

## 3. The verify-first checklist

Nothing below needed code — these are all "click it once and see what happens" (or one SQL query), and several of them determine whether a Blocker above is a live emergency or a already a non-issue:

1. Clock In, Clock Out, Start Break, End Break, and one Approve + one Deny on a test time-off/swap request (resolves Blocker #9)
2. Add a checklist item as "Opening" via Admin Console, check the crew Opening tab (resolves Blocker #10)
3. `select role, count(*) from users where role in ('Shift Leader','Assistant Manager','Office') group by role;` — tells you if Blocker #8 has already hit a real employee
4. Confirm what role string your actual maintenance techs have (resolves whether Blocker #6 is live today)
5. Whatever you paste into the Square secrets (§0) — after you set them, re-run the sandbox test in `SQUARE_INVOICE_SETUP.md` §G before trusting a real customer invoice
6. Is `app_admin_delete_user` (Users tab "Delete") a real SQL delete or a soft flag? (High #6 above)
7. Confirm the Square webhook is actually registered in the Square dashboard once secrets are set (separate from the Supabase side I checked)

---

## 4. Patterns worth a dedicated pass, not one-off patches

- **Role-string drift.** "Shift Lead" vs. "Shift Leader", "Maintenance" vs. "Maintenance Lead", an ungated "Office" role — this is the same bug shape appearing independently in the admin and maintenance audits. Worth one sweep to pick a single canonical spelling per role and grep the whole codebase, instead of continuing to patch individual gates one at a time (already happening — a few newer gates accept both spellings, most don't).
- **Dynamic RPC names slip past the deploy safety net.** I already found and fixed one instance of this in Team Growth during the training deploy; the scheduling audit independently found six more (clock/break/approve-deny). Worth a repo-wide grep for `.rpc(` calls where the name isn't a quoted literal, and either rewriting them as literals or teaching `predeploy_check.js` to follow simple variable assignments.
- **Old-system/new-system splits that silently fork data.** Maintenance (old board vs. Work Orders), Supply Request (three separate pipelines), Concern reporting (legacy harassment list vs. Your Voice) — the same "migration half-finished" shape three times. Each needs an explicit decision: finish the migration and retire the old path, or intentionally keep both and make that obvious in the UI.
- **Uncommitted SQL for the most sensitive modules.** The billing separation-of-duties logic (`wo_invoice_*`) and most core HR functions (`yv_*`, `app_discipline_*`, `app_pip_*`, etc.) exist only in the live database, not in this repo. That means the exact controls protecting money and confidential HR data can't be code-reviewed by anyone, including future-me. Recommend exporting current function definitions into the repo as a documentation pass, independent of any behavior change.

---

## 5. Missing information & stale content — the "hide, don't delete" list

- Emergency Procedures blanks (§1 #4) — highest priority, safety-related
- Live Dashboard's fabricated Square/catering sections (§1 #7) — hide until real, or label unmistakably as sample
- "What's New" help page is frozen at June 25 and is missing three weeks of real shipped features (Daily Store Report, Shift Console, Training Hub Phase 1, Ops Meeting, Marketing v2, Write-Ups, Pay Tools, Command Center, the password migration) — and actively contradicts a few things that changed since (says Learning Paths is "just a sample," says to "Ask Cherry" for an feature that doesn't exist in-app). *(audit_content_stale.md, H1)*
- Front-door PIN/password copy is inconsistent — registration still says "Create a 4-Digit PIN" while the app now requires 8-character passwords; several error messages and labels still say "PIN." *(audit_content_stale.md, H4)*
- Manager Dashboard's "Shortages" tab only shows old data from a form nothing links to anymore (Supply Request replaced it) — candidate to hide or relabel "(archive)."
- Time Clock's home-screen tile literally says "Test mode — pick a test employee" to every user, every day (independently flagged by two separate audits — this is the single most "unfinished-looking" thing a brand-new user encounters).
- The red "PandaDoc Form (needs a label / confirm link)" tile in Forms & Documents, plus two JotForm links that use a per-recipient "Sign invite" URL type instead of a reusable link (worth a quick phone check that they still open for someone who isn't the original recipient).
- Orphaned dead code safe to retire: the old Store Shortage Report form, the legacy Report-a-Concern screen (superseded by Your Voice), an unwired "Employee Readiness Report" RPC.
- Announcements/Updates have no age display and no expiry — old date-bound posts stay looking current indefinitely, and "Delete" on Updates is a real hard delete, which conflicts with the archive-don't-delete rule you set for this project.

---

## 6. Competitor-inspired ideas worth carrying into the roadmap (deduped across all 8 reports)

- **Clock-in identity verification** (Homebase pattern: default to "yourself," optional photo/PIN/geofence) — directly fixes the Time Clock trust problem.
- **Non-blocking schedule confirmation** (When I Work: a dismissible yellow badge, never a hard gate) — fixes Blocker #5 by design, not just a patch.
- **A real work-request → work-order pipeline with a requester-facing tracker** (MaintainX/Fiix pattern) — fixes the "I reported it and have no idea what happened" gap in both Maintenance and, to a lesser extent, Supply Request.
- **A central Payments/Receipts ledger** (Square/HoneyBook pattern) instead of hunting per-quote — most directly delivers "receipts available on the hub" once Square is actually live.
- **AI-assisted "draft a lesson from an existing document"** (TalentLMS/360Learning/Trainual) — flagged by the training auditor as probably higher-leverage than the planned block editor alone, since the real bottleneck behind the placeholder-content problem is almost certainly time to write lessons, not the editor's UX. Worth folding into Phase 2 planning.
- **Split "What's New" into a dated changelog + an evergreen how-to guide**, and re-enable the once-per-version popup so new features actually get surfaced instead of silently shipping.
- **Tap-to-call phone numbers and a "last reviewed" stamp on the Emergency screen** (Beekeeper crisis-tool pattern) — cheap and meaningfully better once the numbers are filled in.

Each full report has 3-5 more, with sources cited.

---

## 7. Full reports (all in `specs/`)

`audit_scheduling.md` · `audit_daily_ops.md` · `audit_maintenance.md` · `audit_catering_payments.md` · `audit_team_hr.md` · `audit_training.md` · `audit_admin_dashboards.md` · `audit_content_stale.md`

No test data was created by any agent (all were network-blocked before reaching Supabase) — there is nothing to clean up from this round.

---

## 8. What I'd suggest for sequencing fix work

Given the scale (roughly 10 Blockers, 15+ High-priority items, plus Phase 2-4 of the training system still ahead), I don't think it's a good idea for me to just start editing 8 sections' worth of files at once — a few of these touch security and payroll-adjacent logic where I'd rather be careful and sequential than fast and parallel. My suggestion, in order:

1. You run the 7-item verify-first checklist (§3) — mostly single clicks, ~15 minutes total, and it tells us which Blockers are live emergencies vs. already-fine.
2. I fix the two confirmed-in-SQL security holes (#1, and #8's role-string sweep) first — small, safe, additive changes, highest risk-reduction per hour.
3. Then the stuck/dead-end Blockers (#5, #6, #10) and the fake-data Blocker (#7).
4. Then High-priority items, then I pick up Phase 2 of the training system in parallel with whatever's left.

I can also just start on all of it now if you'd rather move faster and review as I go — your call.