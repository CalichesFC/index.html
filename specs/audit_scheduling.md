# Audit: Scheduling, Time Clock, Roster
Scope: Schedule Builder/publishing, My Shifts/Confirmations, Time Clock (clock in/out/breaks), On the Clock, Timesheets, My Availability + approvals, Time-Off & Swap requests + approvals, Pre-Shift Lineup, Schedule templates/copy-last-week, Employee Roster.
Method: full read-through of every screen's code path (button → JS handler → RPC → success/error UI), exhaustive cross-check of every RPC name against `rpc_manifest.json`, and an attempt at live Supabase verification. Date: 2026-07-17.

**Live verification could not be performed.** This sandbox's outbound network goes through a mandatory proxy (`localhost:3128`) that enforces a domain allowlist; `https://ikgbihwkqhsfahnswfbz.supabase.co` returned `403 Forbidden` / `X-Proxy-Error: blocked-by-allowlist` on every attempt (confirmed with `curl -v`), and control domains (`google.com`, `api.github.com`) were equally unreachable, so this isn't a Supabase-specific block — no external HTTP call of any kind was possible from this environment. `mcp__workspace__web_fetch` also returned only a bare echo with no way to attach the required `apikey` header or issue a POST, so it can't drive authenticated RPC calls either. **Every finding below is from static code tracing only.** Anything whose truth depends on live DB/RLS behavior is explicitly marked "Unverified — needs a live click-through."

Useful context found along the way: Issac's own `Scheduling_10X_Roadmap.md` (July 2026) already marks "Real time clock: punch in/out, breaks... ✅ Live" and "Shift cover requests... ✅ Live" — and separately, in the same document's gap table, already calls the Time Clock's employee picker a "❌ name-picker" with no PIN/photo/geofence, planned for a future phase. That roadmap entry independently corroborates one of this audit's findings (below) and suggests the "✅ Live" status on time clock/swap-approve was likely never re-verified after whatever change introduced the RPC-name mismatch described in Blocker #2.

---

## Summary

Scheduling, Roster, and Pre-Shift Lineup are the most mature parts of this codebase — the weekly grid, publish guardrails (hard-stop on minor-hours/expired certs, soft-warning-with-required-reason), named templates, drag/copy/paste, and the Roster's certifications/notes/PIP/promotion-history are all genuinely well built with consistent validation. However, the audit found **two Blocker-class issues**: a full-screen "confirm your schedule" gate that can trap an employee with no way out, and six RPC calls (Time Clock's Clock In/Out and Start/End Break, plus the manager's Approve/Deny buttons for time-off and swap requests) that are invisible to the app's own pre-deploy safety net because they're built dynamically rather than as string literals — their live functional status is unverified and should be the very first thing checked before anything else in this report. Several High-priority gaps (a "Test mode" label and unrestricted employee picker shipped on the live Time Clock, an inconsistent "Add employee" fallback for Store/Assistant Managers, no enforced reason on punch edits/deletes) should be fixed before the 30-day launch. Competitor research against Homebase, 7shifts, and When I Work confirms most of these are known, solved problems elsewhere and produced five concrete, scoped improvement ideas below.

---

## Blockers

### B1 — "Confirm your schedule" gate has no close button and can trap the user
**Files:** `js/02_on_load.js` lines 22 (`setTimeout(checkScheduleGate, 450)` inside `enterAppView()`), 25–32 (`checkScheduleGate`), 34–54 (`showScheduleGate`), 65–73 (`schedGateFlagConflict`), 74–82 (`confirmScheduleGate`). Also `js/03_settings_account.js` lines 169–184 (`goBack`).

On login, if `app_pending_schedule_confirm` says the employee has an unconfirmed published week, a full-screen overlay (`#scheduleGate`, `z-index:2147483600`, `background:rgba(18,18,28,.97)`, `inset:0`) is injected directly onto `document.body`. It has exactly two buttons: **"I've seen my schedule — Confirm"** and **"Something is wrong — tell my manager."** There is:
- No X/close button in the template (lines 44–52).
- No backdrop-click-to-dismiss handler on the overlay `div` (compare to other dynamically-created overlays in this codebase, e.g. `ctCoachModal`/`supplyDetailModal`, which explicitly have `onclick="if(event.target===this)this.style.display='none'"` — this one doesn't).
- No coverage by the app's own global "Back" recovery logic: `goBack()` (js/03, lines 172–177) only auto-closes elements matching `[id$="Modal"]` or `.modal-overlay` — `#scheduleGate` has neither that id suffix nor that class, so it is invisible to the one mechanism this app already built for "dismiss a stuck overlay."
- `confirmScheduleGate()` (lines 74–82): on any RPC error it re-enables the button with text "Try again" but **does not hide the overlay**. The user is stuck retrying the same failing call.
- `schedGateFlagConflict()` (lines 65–73): the *only* real escape hatch, but it's a `prompt()` for "What is the conflict with this schedule?" — if the user clicks **Cancel** on that native dialog (the natural reaction if they don't actually have a conflict and just want out), the function returns immediately (`if(note===null) return;`) and the gate stays open. The only way that genuinely guarantees escape is to click through the prompt with OK (even blank), which fires `app_week_flag_conflict` and sends the manager a spurious "something's wrong" notification just to get past the screen.

Net effect: an employee whose confirm call fails for any reason (stale/expired session PIN — this app clears `sessionPin` on `42501` errors in dozens of other places, so this is an anticipated failure mode, not a hypothetical one; a network blip on store WiFi; etc.) is locked out of the **entire app**, including Time Clock, with no obvious way out, right when they may need to clock in for a shift starting in minutes. This is a PWA (`manifest.json`/`sw.js`), so reloading doesn't help — `checkScheduleGate()` re-fires on every load and re-shows the same gate since the pending-confirm state hasn't changed server-side.

**Fix direction:** add a visible "Not now" / X that dismisses without confirming (When I Work's approach — see Competitor section — is a non-blocking yellow badge, not a hard gate), and make `confirmScheduleGate()`'s catch path close the overlay (or offer a clear retry vs. dismiss choice) instead of leaving it stuck.

### B2 — Six RPCs for Clock In/Out, Break Start/End, and Approve/Deny are invisible to the safety net — functional status unverified, verify first
**File:** `js/05_admin_tasks_pip_disciplinary.js` — lines 211/214 (`clockToggle`), 227/228 (`clockBreakToggle`), 986/988 (`reqDecide`).

```js
// line 211
const rpc = open ? 'app_clock_out' : 'app_clock_in';
...
supabaseClient.rpc(rpc, params)          // line 214 — name comes from a variable

// line 227
const rpc = onBreak ? 'app_break_end' : 'app_break_start';
supabaseClient.rpc(rpc, { ... })          // line 228

// line 986
var fn = type==='swap' ? 'app_swap_decide' : 'app_time_off_decide';
supabaseClient.rpc(fn,{...})              // line 988
```

I confirmed by direct grep that **none of these six names — `app_clock_in`, `app_clock_out`, `app_break_start`, `app_break_end`, `app_swap_decide`, `app_time_off_decide`** — appear anywhere in `rpc_manifest.json` (551 entries), and the only place any of those six strings appear in the whole codebase is inside these three ternary expressions. Every *other* literal `.rpc('name', ...)` call across all of `js/03_settings_account.js`, `js/04_employee_roster.js`, `js/05_admin_tasks_pip_disciplinary.js`, `js/07_assignable_tasks_messaging.js` (preshift portion), and `js/08_availability.js` **is** present in the manifest — this gap is isolated to exactly these three dynamic call sites.

I also read `predeploy_check.js` directly to confirm *why*: its RPC-name check (line 103) uses `/\b[\w.]*[Rr]pc\(\s*['"]([a-zA-Z0-9_]+)['"]/g` — deliberately upgraded (per its own comment, lines 96–99) to catch wrapper functions like `smRpc('name', ...)`, `wobRpc('name', ...)`, etc. But it still requires the character *immediately after* `rpc(` to be a quote. At `supabaseClient.rpc(rpc, params)`, the character after `rpc(` is the bare variable `rpc`, not a quote — so this regex, and therefore the whole pre-deploy safety net **and** the SQL health-check query in `API_REFERENCE.md` §6.A (which is generated the same grep-based way), structurally cannot see these three call sites. This is precisely the "dynamic calls can slip through" bug class described in this repo's own house rules.

This means: **the app has zero automated protection today on whether Clock In, Clock Out, Start Break, End Break, or the manager's Approve/Deny buttons for Time-Off & Swap Requests actually work.** If any of the underlying Postgres functions were ever renamed, dropped, or never actually created, no tool in this repo would catch it, and the failure would look exactly like the "silently-dead button" scenario `predeploy_check.js`'s own header comment calls out.

**I could not determine live whether these six functions currently exist** (network blocked, see top of report). Two plausible readings, and I want to be fair to both: (a) they were created directly in Supabase and simply never got added to the manifest — this is a known pattern in this repo (`phase1_scheduling.sql` lines 32–39 explicitly says the `punches` table itself "is not defined in any migration file in this repo... it was created directly in Supabase," strongly implying `app_clock_in`/`app_clock_out` were too), in which case this is a documentation/tooling gap, not a live bug; or (b) something is actually broken. **Given the stakes if it's (b) — nobody could clock in/out or take a break, and no manager could approve or deny a single time-off or swap request — this should be the very first thing verified before anything else in this report, either by clicking each of the three buttons once on a test account, or by running the health-check query in `API_REFERENCE.md` §6.A with these six names added to the comma list.**

**Minimum fix regardless of live status:** add all six names to `rpc_manifest.json` now. That alone closes the blind spot for future deploys even if today's functions are fine.

---

## High-priority issues

### H1 — Time Clock shows "Test mode — pick a test employee" in production, and anyone can punch anyone
**Files:** `index.html` line 1513 (`<div class="hb-sub">Test mode &mdash; pick a test employee</div>`), line 1517 (`<select id="clockEmpSelect">`), lines 263 & 314 (home-screen and menu tiles, both tagged `<span class="rchip staff">Staff</span>` — visible to every employee). `js/05_admin_tasks_pip_disciplinary.js` lines 145–156 (`loadClockEmployees`, populates the dropdown from `app_sched_employees`, i.e. the full roster, with no default to "yourself" and no per-employee re-authentication).

Every staff member sees a "Time Clock" tile on their home screen and main menu. Opening it shows the literal, unedited text **"Test mode — pick a test employee"** as the screen's subtitle, and a dropdown listing every employee at the company with no default selection and no secondary check (PIN/photo) tying the punch to whoever is actually standing at the device. Anyone who can open this screen can clock **any other employee** in or out or start/end their break. This is corroborated by Issac's own `Scheduling_10X_Roadmap.md`, which independently lists "Clock-in verification (PIN kiosk, photo, geofence)" as a gap and calls today's implementation a "❌ name-picker." Two separate problems bundled here: (1) leftover dev-mode copy shipping to every employee on a core daily-use screen undermines trust that punches are "real"; (2) no per-person verification is a real time-theft/buddy-punching exposure and a wage-hour record-integrity risk. See Competitor Ideas below for how Homebase solves this.

### H2 — Store/Assistant Managers get a bare `prompt()` labeled "(test roster)" instead of the real Add-Employee form
**Files:** `js/03_settings_account.js` lines 292–296 (`initScheduleBuilder`, gates the "Add employee" nav link on `schedIsMgr()`) and lines 984–995 (`schedAddEmployee`, gates the *real* modal on the stricter `isAdminManager()`). `js/01_part01.js` lines 323–329 (`schedIsMgr`, true for role `'Manager'`, developer, **or `currentUser.isStoreManager===true`**) vs. line 278 (`isAdminManager`, true only for role `'Admin Manager'`/`'Vice President/Co-Owner'`/developer). `isStoreManager` is set in `js/07_assignable_tasks_messaging.js` line 19 for anyone flagged `store_manager` or `assistant_manager` at *any* store.

The Schedule Portal's manager rail (which shows "➕ Add employee") is gated by `schedIsMgr()` — a broader check that includes per-store Store/Assistant Managers. But the click handler, `schedAddEmployee()`, checks the *narrower* `isAdminManager()`, and if that's false (true for any Store/Assistant Manager whose top-level `role` isn't literally "Admin Manager"), falls through to:
```js
const name = prompt('New employee name (test roster):');
...
supabaseClient.rpc('app_sched_add_employee', { p_username: currentUser.username, p_password: pin, p_name: name, p_linked_username: '' });
```
This creates an employee with **no wage, no store assignment, no position** — none of the fields the real Roster "Add Employee" modal (`rosterModal`, `saveRoster()`) captures. A Store Manager doing exactly what the nav invited them to do ends up with an incomplete employee record (silently $0 labor cost on the schedule grid, not correctly filtered to their store) and a jarring native `prompt()` dialog that literally says "(test roster)" in a production app. **Fix direction:** either gate the nav link the same way as the handler (hide "Add employee" from non-Admin managers), or point the Store-Manager path at the same `openRosterModal(null)` flow Admin Managers get.

### H3 — Punch edits and deletes don't require a reason
**File:** `js/05_admin_tasks_pip_disciplinary.js` lines 313–341 (`openPunchEditor`/`loadPunchList`, "reason for edit" input rendered but never validated), 342–355 (`savePunch` — checks date/time fields are present, never checks `reason` is non-empty before calling `app_punch_edit`), 356–362 (`deletePunch` — only a generic `confirm('Delete this punch?')`, no reason field exists at all before calling `app_punch_delete`).

A manager can change someone's paid clock-in/clock-out time, or delete a punch outright, with zero recorded justification. Per FLSA record-keeping guidance (see Competitor/Compliance research below), every timecard edit should log the old value, new value, who changed it, when, and why — a system that allows silent edits is treated as an unreliable record in a DOL wage-hour dispute, which shifts the burden of proof onto the employer. This is a real compliance gap for what will very shortly be real payroll data, not just a UX nicety. **Fix direction:** make the reason field required on edit (client-side validation already has the input, it just isn't enforced) and add a required reason prompt on delete.

### H4 — No pending-request badges anywhere, and the one badge hook that exists is dead code
**Files:** `index.html` lines 306 (`btn-availApprovals`) and 310 (`requestsBtn`) — plain menu tiles, no count element. `js/08_availability.js` line 128, inside `availDecide()`: `if(typeof loadAvailBadge==='function') loadAvailBadge();` — **`loadAvailBadge` is never defined anywhere in the codebase**, so this is a guarded no-op; the `typeof` check means it fails silently instead of throwing, so nothing visibly breaks, but it's clearly an unfinished feature (something intended a badge and never built it).

A manager has to remember to manually open "Availability Requests" or "Time-Off & Swap Approvals" to find out anything is waiting — there is no red/yellow count anywhere in the main menu. Across 5 locations with rotating shift leads, a request can sit unnoticed for days. Given the owner's explicit "no missing information" priority, an unnoticed pending request is functionally the same problem as a broken approval button.

---

## Missing/incomplete features

- **No open-shift marketplace / no link between "approve a swap" and "reassign the shift."** `saveSwap()` (js/05 line 926) only sends a note to the manager (`app_swap_create`); there's no list of eligible coworkers who could claim it. Approving it (`reqDecide('swap', id, true)`, line 983) just flips a status via `app_swap_decide` — the manager still has to separately, manually go into the Schedule Builder and reassign the shift by hand; nothing connects the two actions. **This is already tracked** in `Scheduling_10X_Roadmap.md` ("Open-shift marketplace... ⚠️ cover-request only... Build", Phase 1) — worth confirming this audit's read matches Issac's intent.
- **Swap requests can't be cancelled by the employee; time-off requests can.** `cancelTimeOff()` + `app_time_off_cancel` exists and is wired to a visible "Cancel" button for pending time-off requests (js/05 lines 907–915, and the button at `empHomeRender` line 871). The parallel "My Shift Cover Requests" list (lines 876–887) has no such button, and there is no `app_swap_cancel` anywhere in the manifest or codebase — confirmed by grep. An employee who submits a swap request by mistake, or whose plans change, has no self-service way to retract it; they'd have to ask a manager to deny their own request.
- **Roles/positions can be added but never edited, renamed, recolored, or retired.** `rolesModal` (index.html lines 1361–1383) and `renderRolesList()`/`saveNewRole()` (js/04_employee_roster.js lines 710–748) only support **Add**. The manifest confirms only `app_position_add` and `app_position_tally` exist — no `app_position_edit`/`_delete`/`_archive`. A mistyped name or wrong color, or a position the business stops using, is permanent clutter in every position picker across Scheduling and Pre-Shift Lineup forever.
- **"On the Clock" live board doesn't auto-refresh.** `loadLiveBoard()` (js/05 lines 245–261) only runs on open or when the manual "🔄 Refresh" button (index.html line 1542) is tapped. A manager watching it during a rush has to keep re-tapping.
- **No reminder/nudge for staff who haven't confirmed their schedule.** `openWeekConfirms()` (js/03 lines 661–686) is read-only — it lists who has/hasn't confirmed but has no per-row "remind" action, unlike the Admin Task system elsewhere in this same app (`app_task_nudge`, used in js/01_part01.js line 263) which already has that exact pattern to copy.

---

## Stale-content candidates (hide, don't delete)

- **Schedule templates apply blind, with no staleness signal.** `applySchedTemplate()` (js/03 lines 950–964) loops through a saved `pattern` array and calls `app_sched_upsert_shift` for each entry using the **stored** `p.emp` (employee id) and `p.pos` (position id) from whenever the template was saved — with no check that the employee is still active/still works at that store, or that the position still exists. `renderSchedTemplates()` (lines 921–932) shows only a name and shift count, no "created" or "last used" date. A manager could load "Standard Summer Week" from last year and silently create shifts assigned to a since-terminated employee, or under a position that's since been renamed — and because the schedule grid only renders rows for employees present in the current `schedState.data.employees` list, a shift assigned to a no-longer-active employee id may not even be visible on the grid afterward, despite existing in the database. **Suggest:** show a relative "created X weeks ago / last applied Y" timestamp, and validate template employee/position ids against the current active roster before applying, surfacing any that no longer match.
- **Whether "confirmed" schedule status survives a post-publish edit is unverified and worth checking.** I found no call anywhere that resets/un-confirms an employee's `app_week_confirm` status after a manager edits shifts post-publish (`schedSaveShift`, `schedDeleteShift`, or re-running `schedPublish`/`schedDoPublish`, js/03 lines 734–862). If the server-side logic doesn't re-open confirmation on edit, a manager could see a green "confirmed ✓" on `openWeekConfirms()` for a schedule that has since changed underneath that employee, which is exactly the kind of stale-flag-misleads-a-manager scenario worth a direct check. **Unverified — needs a live click-through** (confirm a week as a test employee, edit that week's shifts as test_admin, reload `openWeekConfirms()` and see whether the confirmation persists).
- **What happens to a terminated employee's already-published future shifts is unverified.** `rosterSetActive(id, false, name)` (js/04 lines 702–709) calls `app_emp_set_active` with a warning that reads "They will be archived (no schedule access) but their history is kept" — but it's unclear from the frontend whether their *existing future shifts* get flagged, unassigned, or just silently stop appearing on the grid. Worth a live check before this matters for a real termination.

---

## Competitor-inspired improvement ideas

Researched Homebase, 7shifts, and When I Work directly (see sources below) against the specific gaps found above.

1. **Clock-in identity verification (Homebase model).** Homebase's time clock auto-assigns a PIN per employee and snaps a photo at clock-in specifically to prevent buddy punching; its Essentials plan adds a configurable GPS geofence (150 ft/1 block/5 blocks) around the store. Directly addresses H1: replace the free-pick-anyone dropdown with "clock in as yourself" (default-select the logged-in user's own linked employee record) plus a lightweight photo capture using the same camera-compression code this app already has for task photos (`onTaskPhotoPicked`/`compressToGlobal`, reusable).
2. **Non-blocking schedule confirmation instead of a hard gate (When I Work model).** When I Work prompts for confirmation on sign-in but never blocks the app — unconfirmed shifts just show highlighted in yellow on the employee's own schedule, and managers see a yellow/green badge next to each name in the scheduler. Directly addresses B1: turn `#scheduleGate` into a dismissible banner/badge rather than a full-screen unclosable modal, while keeping the "something's wrong" flag as an option, not the only escape.
3. **Shift Pool / partial-shift offers (7shifts model).** 7shifts lets an employee post a whole shift *or only part of one* to a poolable marketplace visible to eligible coworkers (same location/role), routes trades through an explicit "Awaiting Manager Approval" status, and notifies both parties by push/SMS/email once approved — with the schedule updating automatically as part of that approval, not as a separate manual step. Directly addresses the swap-marketplace gap already on Issac's own roadmap; the "partial shift" idea (cover only the back half of a shift) is worth adding to that Phase 1 scope since it isn't currently in the roadmap doc.
4. **Enforced, immutable audit trail on every punch edit (FLSA compliance pattern).** Industry guidance is explicit: a punch-edit record needs the old value, new value, editor identity, timestamp, and reason, and edits without that trail get treated as unreliable in a DOL wage dispute (burden of proof shifts to the employer). Directly addresses H3 — make the existing (unused) reason field required, and consider surfacing an edit history per punch rather than only "edited by X" (currently shown, but not the prior value).
5. **Persistent pending-count badges, not tap-to-discover.** Both 7shifts and When I Work surface outstanding approvals as a badge on the relevant nav item rather than requiring a manager to open the screen to find out. Directly addresses H4 — this is a small, contained addition: a lightweight `app_requests_pending`-style count call on `applyRoleUI()` render, badging `requestsBtn` and `btn-availApprovals`.

Sources: [Free Time Clock — Prevent buddy punching with Homebase](https://www.joinhomebase.com/time-clock/buddy-punching) · [How To Stop Buddy Punching in its Tracks | Homebase](https://www.joinhomebase.com/blog/buddy-punching) · [Using Shift Confirmation – When I Work Help Center](https://help.wheniwork.com/articles/using-shift-confirmation-computer/) · [Confirming Your Shifts – When I Work Help Center](https://help.wheniwork.com/articles/confirming-your-shifts-computer/) · [How to Trade Shifts (for Employees) – 7shifts](https://kb.7shifts.com/hc/en-us/articles/4417505341715-How-to-Trade-Shifts-for-Employees) · [Offer Up a Part of Your Shift – 7shifts](https://kb.7shifts.com/hc/en-us/articles/17419859442963-Offer-Up-a-A-Part-of-Your-Shift) · [7shifts 101: The Shift Pool](https://kb.7shifts.com/hc/en-us/articles/31854832817299-7shifts-101-The-Shift-Pool) · [What to include in a legally compliant timekeeping audit trail | Open Time Clock](https://www.opentimeclock.com/docs/blog1/november-2025/what-to-include-in-a-legally-compliant-timekeeping-audit-trail) · [Employee Clock In and Clock Out Policy: Best Practices for Restaurants – 7shifts](https://www.7shifts.com/blog/employee-clock-in-and-clock-out-policy/)

---

## Test records you created

**None.** No RPC calls were made and no data was written to the production database. Live verification was attempted (per the task's method) but was blocked at the network layer before any request reached Supabase — see the note at the top of this report for the exact proxy error. There is nothing to clean up from this audit.

---

## Open questions for Issac

1. **Top priority: please verify Blocker B2 directly** — click Clock In, Clock Out, Start Break, End Break once each on a test account, and Approve (or Deny) one test time-off and one test swap request as `test_admin`. If all six work, the fix is just adding their names to `rpc_manifest.json` (low effort, high value regardless). If any fail, that's a live production outage on core daily-use features that needs fixing before anything else in this list.
2. Is the Time Clock intentionally a **shared-kiosk model** (one tablet at the register, anyone can punch anyone in with manager oversight), or should it be self-service per employee? That decision determines whether H1 is a copy-cleanup + optional-hardening item or a more involved rebuild.
3. Should Store/Assistant Managers be able to add employees at all from the Schedule Portal (H2)? Right now the nav item is shown to a wider group (`schedIsMgr()`) than the handler actually supports (`isAdminManager()`) — either the nav item should be hidden from non-Admin managers, or the handler should be upgraded to give them the real form.
4. Is the missing reason-requirement on punch edits/deletes (H3) intentional for a small team where "we all know who changed what," or should it be enforced before real payroll goes live on this system?
5. Any plans for the referenced-but-never-defined `loadAvailBadge()` (js/08_availability.js line 128)? It looks like a started-but-abandoned feature.
6. Does editing a published, already-employee-confirmed week's shifts reset that employee's confirmation status server-side? Couldn't verify from the frontend alone (see Stale-content section) — worth a quick live check.
7. Confirmed for scope-narrowing: `js/24_requests_rails.js`/`requests_rails.sql` turned out to be an **HR/W-2 + Party-Pack + Gift-Card request system**, unrelated to Time-Off/Swap requests despite the filename similarity — flagging in case it was expected to be in-scope under a different assumption.
