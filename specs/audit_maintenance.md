# Maintenance & Equipment — Deep Audit (Caliche's Hub)

**Auditor pass:** 2026-07-17 · Scope: everything maintenance/equipment (Report a Repair, Equipment History, Preventive Maintenance, Work Orders / Maintenance Board, Maintenance Billing `wo_invoice_*`, Vehicles & Service, Damage reports).
**Method:** read-only code + SQL trace of `index.html` and `js/01,05,07,08,09,10`, `preventive_maintenance.sql`, `rpc_manifest.json`, `API_REFERENCE.md`. No files changed except this report.

> **Live-verification limitation (read this first).** The sandbox has **no network egress** — `curl` to `https://ikgbihwkqhsfahnswfbz.supabase.co` returns HTTP 000 (exit 56) even for Supabase itself, and the only other network tool (`web_fetch`) is GET-only with no custom headers, so it cannot POST an RPC with the `apikey` header. **I could not run the instructed live test** (create a repair as `test_crew`, assign/progress as `test_admin`) or introspect the database. Every finding below is from **code/SQL tracing**; anything that can only be settled by a real click-through or DB introspection is tagged **[Unverified — needs live check]**. No test records were created (see that section).

---

## 1. Summary

The Maintenance area is **mid-migration and it shows**. A newer, genuinely good **Work Orders** system (`js/09`, `app_wo_*` + `wo_invoice_*` billing + leadership dashboard) has been promoted to "the single repair flow for all staff," and the **older Maintenance Board** (`js/05`, `app_maintboard_*`) has been "retired" (tile force-hidden). But the retirement was only half-completed, leaving **two parallel repair systems that don't talk to each other** and several **dead-ends the owner explicitly asked to eliminate**.

The single most serious problem: **a user whose role is `Maintenance` still logs in straight onto the retired board, can't reach the menu or the live Work Orders, and their only "Back" is a logout** — the exact "can't go back / getting stuck" failure the owner flagged. Layered on top, the people's own reports are scattered across the old and new backends, so **a crew member who reports a repair the blessed way (Work Orders) has no screen that shows them what happened to it**, and an **equipment record's "Maintenance reports" history is blind to Work Orders**.

The billing module is structurally solid and models separation-of-duties in the UI, but **the SQL that actually enforces it is not in the repo and I have no DB access, so the core control the owner asked me to verify is unconfirmed.** Equipment History, QR codes, warehouse in-use/backup split, and Preventive Maintenance are the healthiest parts.

**Counts:** 2 Blockers, 5 High, 6 Medium, ~6 Low/Polish. Nothing here is cosmetic-only; most are "looks done, isn't."

**What's genuinely good (so we don't break it):** Equipment edit form is complete (model/serial/vendor/warranty/manuals-as-links/troubleshooting/notes/status/open-issue — `saveEquipment` js/07:713); QR label + "Report a problem" label printing (js/07:654) and whole-store QR sheet (js/07:665); Warehouse In-use/Backup split with admin toggle (js/07:349-359, `app_warehouse_list`/`app_equipment_set_backup`); PM schedules with overdue/due-soon badges, structured checklists, and service-history log (js/07:498-532); the Work Order status model + timeline + photos + cost capture (js/09:391-503); the invoice status model with a visible separation-of-duties note (js/09:117). Most views have real Back buttons.

---

## 2. Blockers

### B1. The `Maintenance` role lands on the RETIRED board and gets stuck (Back = logout)
**Severity: Blocker.** Files: `js/02_on_load.js:7-11` and `js/02_on_load.js:644-648`; `js/05_admin_tasks_pip_disciplinary.js:524`, `:548-550`.

On login, both entry paths do:
```js
if (user.role === 'Maintenance') {
    document.getElementById('maintenanceBoardView').style.display = 'block';
    switchMaintTab('stores'); fetchMaintenanceBoard(); fetchVehicleMaintTracker();
} else { /* main-menu */ }
```
But `maintenanceBoardView`'s tile is force-hidden as retired (`js/05:524 … maintBoardBtn.style.display='none'; /* retired: Work Orders replaces the Maintenance Board */`), and its only Back button calls `maintBoardBack()` which for this role **logs the user out** (`js/05:549 if (currentUser.role === 'Maintenance') { logout(); }`).

**Net effect for a maintenance tech:** they never see the main menu, never reach the live Work Orders / Equipment / PM screens, land on a board that no longer receives new repairs (those go to `app_wo_*` now), and the only way "off" the screen is logout. This is a textbook dead-end and it hits the exact staff who do the repairs.

**[Partly Unverified — needs live check]:** confirmed in code; the one assumption is that real maintenance staff carry the role literally named `Maintenance` (it *is* an assignable role — `PERM_ROLES` in `js/04:783`). Confirm the role your techs actually have. If they do use `Maintenance`, this is a hard blocker for that whole role.

**Fix direction:** route `Maintenance` to the main menu like everyone else (or to `openWorkOrders()` on the queue), and change `maintBoardBack()` to `openMenu()`. Also see B2 (they still couldn't see their queue).

### B2. Maintenance techs are locked out of the Work Orders **queue** by a role-name mismatch
**Severity: Blocker (compounds B1).** Files: `js/09_work_orders_maintenance_phase.js:6`, `:8`, `:301`; `js/04_employee_roster.js:783`.

`woIsMaint()` decides who counts as maintenance in the new system:
```js
function woIsMaint(){ var r=currentUser.role; return r==='Maintenance Lead'||r==='Maintenance Contributor'; }
```
But the roster's assignable roles are `['Manager','Store Manager','Finance Approver','Maintenance Lead','Shift Lead','Crew Trainer','Maintenance','Blue Apron','Crew Member']` (`js/04:783`). So:
- `Maintenance Contributor` **is not a real, assignable role** (it's referenced only here).
- The real tech role `Maintenance` is **not** recognized by `woIsMaint()`.

Consequences in `openWorkOrders()` (js/09:8) and `woTabs()` (js/09:301): a `Maintenance`-role user is treated as neither maintenance nor manager, so they see **only the "Report" tab** — no "My Queue," no "Board," no "Completed." Even if the backend grants them `can_work` on a specific WO, **they have no screen that lists the work assigned to them.** Combined with B1 they can't even get here.

**Fix direction:** make `woIsMaint()` include `'Maintenance'` (and either add `Maintenance Contributor` to `PERM_ROLES` or drop it from the check). One-line change, but confirm against how the backend `app_wo_list` scopes `queue`.

---

## 3. High-priority issues

### H1. Two parallel repair systems that don't talk — the app's central maintenance drift
**Severity: High.** Old system: `maintenanceView` form → `submitMaintenance()` (`js/10:814`) → `saveToSupabase('maintenance_logs', …)` + Google-Apps-Script PDF. Read back by `app_maint_for_equipment` (equipment "Maintenance reports" panel, `js/07:582`), `app_maint_resolve` (mark-resolved, `js/07:622`), `app_maintboard_list` (retired board), and `app_my_maintenance_submissions` (My Submissions, `js/10:16`). New system: `app_wo_*` work orders (`js/09`), `app_maint_dashboard` leadership view (which explicitly reads "work-order costs and maintenance invoices," `js/01:830`), and `wo_invoice_*` billing.

These share **no data.** A repair filed through the blessed "Work Orders" flow never appears in `maintenance_logs`, and vice-versa. Downstream breakage:

- **H1a — Equipment "Maintenance reports" history is blind to Work Orders.** On one equipment-detail screen there are **two different "report" buttons going to two backends**: the prominent "🔧 Report a problem" → `woReportForEquipment()` (new/`app_wo`, `js/07:402`) and the "Maintenance reports → ＋New" → `openMaintenanceForEquipment()` (old/`maintenanceView`, `js/07:594` → `js/08:167`). The history list under "Maintenance reports" is fed by `app_maint_for_equipment` (old), so **the machine's actual repair history — the Work Orders — is not shown on its record.** The owner listed "maintenance-reports history per machine" as a required feature; today it silently shows only the deprecated stream.
- **H1b — Reporter can't track their own repair (missing information).** "My Submissions" (`app_my_maintenance_submissions`, `js/10:16`) reads the **old** table, and regular staff get **only the Report tab** in Work Orders (H2/B2). So a crew member who reports via Work Orders sees "You have not submitted any maintenance requests yet" and has **no screen at all** showing status/among/manager notes for what they reported.

### H2. Separation-of-duties (verifier ≠ approver) is **unverifiable** and not enforced client-side
**Severity: High.** Files: `js/09:103`, `:112-118`; SQL: **absent from repo.**

This is the control the task specifically asked me to confirm by reading the SQL bodies. **The bodies do not exist anywhere in the repo** — `wo_invoice_verify`, `wo_invoice_approve`, `wo_invoice_pay`, `wo_invoice_void`, `wo_bill_actor`, `app_wo_*`, `app_equipment_*`, `app_maint*` are referenced only by name in `API_REFERENCE.md`; the only maintenance SQL committed is `preventive_maintenance.sql`. With no DB access I cannot read the role checks, so **the §5 "verified 2026-07-09" claim cannot be re-confirmed from here.**

What I *can* see: the frontend gates the **Verify** button on `perm.mgr` and the **Approve** button on `perm.finance` (`js/09:112-113`), both flags coming from the backend `wo_invoice_get`. A user who holds **both** perms would see Verify, then (after status → `operational_verified`) Approve — the UI does **not** stop the same person from doing both. The entire separation-of-duties therefore rests on a server check inside `wo_invoice_approve` that I can neither see nor test. **[Unverified — needs live check / DB introspection.]** This is the highest-value thing for you to confirm before go-live (see Open Questions).

### H3. Invoice line items stay editable *after* operational verification (no re-verify)
**Severity: High.** File: `js/09:103`, `:106-108`.
```js
var locked=(iv.status==='finance_approved'||iv.status==='paid'||iv.status==='void');
var canEdit=perm.mgr && !locked;
```
`operational_verified` is **not** in the locked set, so a manager can add or delete line items — **changing the total** — on an already-verified invoice, and it stays "Verified (ops)." Finance can then approve a different amount than was verified, defeating the point of the verification step. In AP systems, editing a verified document should kick it back to draft/unverified. **[Backend may re-check on approve — Unverified]**, but the frontend clearly permits the edit path.

### H4. The `wo_*` / `app_wo_*` / `app_equipment_*` / `app_maint*` SQL is not in version control
**Severity: High (process/risk).** The money-handling and separation-of-duties logic for a launch-critical area lives only in the live database. There is no SQL file to review, diff, or restore, and — as H2 shows — no way to audit the control that protects payments. For a production app with no staging, uncommitted DDL for the billing engine is a real risk. **Recommend:** export the current function bodies (`pg_get_functiondef`) into a `maintenance_workorders.sql` in the repo and add them to §7 of `API_REFERENCE.md`.

### H5. Work Orders can get stuck in states nobody drives to a close
**Severity: High.** File: `js/09:425-436` (`woActions`), `:305`/`:371` (statuses).
- **No "Cancel" action exists** even though `Cancelled` is a defined status (`woStatusChip`, `woIsDone`). A mis-reported/duplicate/￢actually-broken WO **cannot be cancelled** — it has to be pushed all the way through Start → Document → Verify → Close, or it sits in `Reported`/`Assigned` forever. `app_wo_advance` is called with `start/hold/resume/document/verify/reopen` but never `cancel`. **[Backend may support `cancel` — Unverified]**, but there is no button.
- **`Documented` stalls silently.** Only a manager or `Maintenance Lead` can "Verify & close" (`js/09:432`). If neither looks, the WO sits Documented indefinitely; the only cue is a line on the card ("Awaiting operational verification," `js/09:399`). No reminder/escalation. Every RPC the module calls **is** present in `rpc_manifest.json` (checked), so this is a workflow gap, not a broken call.

---

## 4. Missing / incomplete features

- **M1. No requester-facing "track my request" view.** (Root cause of H1b.) There is no screen where a rank-and-file reporter can see the status of a repair they submitted through Work Orders. Competitors treat this as table-stakes (see C-ideas).
- **M2. Preventive Maintenance may strand tickets on the retired board.** The old board special-cases PM tickets (`js/05:717-718`, "Preventive Maintenance" reporter, `maintPmDone` → `app_pm_ticket_done`), and PM completion calls `app_pm_close_tickets` (`js/07:426`, `:467`). If a scheduler/cron still creates PM tickets into the `app_maintboard_*` tables, those land on a board **that is hidden from everyone**. PM does have a live surface (Equipment → "Maintenance due" `openMaintDue`/`app_pm_list`, and per-machine `loadPmFor`), so schedules themselves are visible — but board-side PM tickets could be orphaned. **[Unverified — needs DB check: does anything still insert PM rows into the maintboard tables?]**
- **M3. Daily PM push reminder is defined but likely not scheduled.** `app_pm_reminder()` exists in `preventive_maintenance.sql:170`, but the `pg_cron` line is commented out (`:190`). Confirm the cron job is actually installed in prod, or "daily reminder" is a feature-on-paper. Also note the reminder targets role `Maintenance` (`:180`) — the same role that's stuck per B1.
- **M4. Store Manager can open Vehicles & Service but can't use it.** The tile shows for Store Manager (`js/05:525` via the `isManager` at `:442`, which includes `Store Manager`), but inside the tracker `canEdit` uses a *different* `isManager` (`js/05:593-594`) that **excludes** Store Manager, so the "Mark Serviced" buttons never render and no message explains why. View-only dead-space.
- **M5. Vehicles & Service is a salvage view bolted onto a retired screen.** `openVehiclesService()` (`js/05:565`) re-opens `maintenanceBoardView` and flips to the vehicles tab; its visibility depends on `maintBoardAllowed = currentUser.maint_board_access !== false` (`js/05:443`), a per-user switch inherited from the retired board. Functional but fragile; if that flag is ever set false (or not provisioned), the vehicle tracker silently disappears.
- **M6. Old "Report a Repair" registry link is by name, new one is by id.** The old `maintenanceView` dropdown stores the equipment **name string** (`js/08:153`, `value=e.name`), the Work Order form stores the equipment **id** (`js/09:309`). Mixed keys make cross-referencing a machine's history harder and is part of why the two systems can't be reconciled cleanly.

---

## 5. Stale-content candidates

- **S1. In-app instructions point at the hidden old tile.** Help text `index.html:1761` ("**Where:** Work → Report a Repair") and Emergency Mode `js/08:224` ("File a repair report (Work → Report a Repair)") send users to `btn-maintenance` ("Report a Repair"), which is **display:none by default** and only appears if a manager toggles the per-user form permission (`FORM_KEYS`, `js/01:48`). Staff following these instructions will not find the tile. Update copy to point at **Work Orders** (or re-expose the old tile deliberately).
- **S2. `js/09` header comment is stale/misleading.** Line 1 still reads "Maintenance Phase 1 (BETA, test-gated; does NOT touch live Maintenance Board)." In reality Work Orders is shown to **all** staff (`js/05:526`) and the board is retired. Anyone reading the code will misjudge what's live.
- **S3. `API_REFERENCE.md` §5 "Verified 2026-07-09."** Predates the board-retirement/role wiring above and asserts the `wo_*` frontend is "structurally sound (no broken calls)." Calls are indeed all in `rpc_manifest.json`, but "structurally sound" hides the workflow/role dead-ends in this report. Re-date and add a pointer to these findings.
- **S4. Retired Maintenance Board is live dead-code.** `openMaintenanceBoard`, `fetchMaintenanceBoard`, priority/deadline/notes handlers (`js/05:552-738`) still run (they're invoked by `openVehiclesService` and the `Maintenance`-role landing). Keeping a whole retired screen executing is how B1 happened. Decide: fully retire (and migrate its open tickets) or un-retire it — living in between is the risk.
- **S5. Stale-data check to run in prod (couldn't run it here — no DB):** count `Resolved`-status rows still on `app_maintboard_list` (the view already filters them out client-side, `js/05:671`) and any obviously test/placeholder equipment rows. Flagged as a to-do because I can't query the DB.

---

## 6. Competitor-inspired ideas (UpKeep · MaintainX · Fiix)

Grounding: MaintainX/UpKeep/Fiix are mobile-first CMMS with QR-per-asset, a **work-request portal where the requester tracks status and gets notified**, an explicit **work-request → work-order** promotion step, an **asset hierarchy** with a per-asset audit trail, and dashboards that surface **overdue** work at a glance. Sources below.

1. **Unify on one "request → work order" pipeline (fixes H1).** MaintainX separates a lightweight *work request* from an approved *work order*; the request, once triaged, becomes the WO and carries its history. Adopt this: make the old `maintenance_logs` path either feed `app_wo_create` or retire it, so a machine has **one** history. This is the highest-leverage structural fix.
2. **Give reporters a "My Requests" tracker with status + notifications (fixes H1b/M1).** Every CMMS lets a requester see "Submitted → Assigned → In progress → Done" on the things they filed, with an email/push on status change. You already have push infra (`app_push_*`, `send-push`); surface a reporter view keyed to the submitter and notify on `app_wo_advance`.
3. **Model an explicit work-order lifecycle with a Cancel/On-Hold-with-reason and overdue SLAs (fixes H5).** Fiix/MaintainX expose Open/On-Hold/Cancelled/Done as first-class states and dashboard "overdue" widgets. Add the missing **Cancel** transition, and add a **"stuck" surfacing** (Documented > N days, Assigned-but-not-Started > N days) to the leadership dashboard so nothing rots in a status nobody watches.
4. **Asset hierarchy + per-asset audit trail (improves Equipment History).** CMMS asset hierarchies (store → line → machine → component) give a "comprehensive audit trail of maintenance performed" per node. Even a flat "parent store / child machine" link would let the equipment record roll up *all* work — PM logs, work orders, invoices — in one timeline instead of today's split panels.
5. **Enforce separation-of-duties in data, and show it (hardens H2/H3).** Best practice is the approver record being provably ≠ the verifier, and a verified document auto-reverting to draft when edited. Lock line edits at `operational_verified` (or re-set to draft on edit), and record verifier/approver user-ids so the control is auditable, not just a UI note.

Sources: [MaintainX Work Requests](https://www.getmaintainx.com/use-cases/work-request-management) · [MaintainX request portals](https://help.getmaintainx.com/set-up-a-request-portal) · [MaintainX Work Order Guide](https://www.getmaintainx.com/blog/work-order-guide) · [Fiix Work Orders](https://fiixsoftware.com/cmms/work-orders/) · [Fiix Preventive Maintenance](https://fiixsoftware.com/cmms/preventive-maintenance-software/) · [CMMS roles & permissions (ClickMaint)](https://www.clickmaint.com/blog/cmms-user-roles-and-permissions) · [MaintainX vs UpKeep (Fabrico)](https://www.fabrico.io/blog/maintainx-vs-upkeep-manufacturing-cmms-comparison/)

---

## 7. Test records created

**None.** The instructed live test (create a repair as `test_crew`, then see/assign/progress it as `test_admin`, labelled "TEST - audit - do not process") **could not be performed**: the sandbox shell has no network egress (curl to Supabase → HTTP 000 / exit 56), and the only networked tool available (`web_fetch`) is GET-only and cannot send the `apikey` header or a JSON body, so RPC POSTs are impossible from here. Per the task's fallback ("If no shell/network tool, rely on code tracing and say so"), everything above is code/SQL tracing. **Nothing was created, modified, or deleted in the database or the app.** The only file written is this report.

**To finish the live half of this audit (on the PC, with network):**
```
curl -s -X POST 'https://ikgbihwkqhsfahnswfbz.supabase.co/rest/v1/rpc/app_wo_create' \
  -H "apikey: <anon key from js/01_part01.js:4>" -H "Content-Type: application/json" \
  -d '{"p_username":"test_crew","p_password":"1111","p_title":"TEST - audit - do not process","p_description":"audit","p_location":"Roadrunner","p_category":"repair","p_priority":"low","p_safety_impact":false}'
```
then `app_wo_list`/`app_wo_assign`/`app_wo_advance` as `test_admin`, and `wo_invoice_verify` then `wo_invoice_approve` as the **same** user to prove the separation-of-duties rejection (H2).

---

## 8. Open questions for Issac

1. **What role do your actual maintenance techs have — `Maintenance` or `Maintenance Lead`?** This decides whether B1+B2 are live blockers (I believe they are) or already dodged.
2. **Is the Maintenance Board truly retired?** If yes, we should migrate its open tickets into Work Orders and stop routing anyone to it. If no, we should un-hide it. The in-between state is what's biting.
3. **Does `wo_invoice_approve` actually reject when the approver == the verifier?** (H2) I can't see the SQL. Please paste `pg_get_functiondef` for `wo_invoice_verify`, `wo_invoice_approve`, `wo_invoice_pay`, `wo_bill_actor` — or run the same-user test in §7.
4. **Should editing a verified invoice re-open verification?** (H3) Confirms whether the current "verify then edit lines" path is a real hole.
5. **Is the PM daily push cron installed in prod, and does anything still create PM tickets on the retired board?** (M2/M3)
6. **Where should a crew member see the status of a repair they reported?** (H1b/M1) Confirm you want a requester tracker — it's the biggest "no missing information" win here.
7. **Can we commit the maintenance/work-order/billing SQL into the repo?** (H4) It's currently only in the live DB.
