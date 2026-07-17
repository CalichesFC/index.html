# Daily Operations / "Work" Section — Launch Readiness Audit

**Scope:** Store Pop-In Inspection, Temperature Logs (+7-day history), Shift Checklists
(Opening/Closing/Cleaning), Inventory Count, Supply Request (new/mine/Incoming/Catalog),
Vehicle & Trailer Check-Out, Vehicle/Trailer Damage report.
**Method:** Full read-only code trace of `index.html` (2,509 lines) and `js/01_part01.js`
through `js/27_marketing_v2.js`, cross-referenced against `rpc_manifest.json` (556 known-good
RPC names) and the relevant `.sql` migration files in the repo. Competitor research via web
search (Jolt, Zenput/GoSpotCheck, plus adjacent DVIR/fleet and restaurant-inventory tools).
**Auditor:** read-only — no files modified except this report.

**Live-verification limitation (read this first):** The task asked me to exercise real flows
against the Supabase REST API (`test_admin`/`test_crew`, PIN `1111`). I attempted this and
could not: the shell tool (`mcp__workspace__bash`) has no outbound network route in this
sandbox (empty `/etc/resolv.conf`, no default route, `curl` fails with exit 56 / status 000
to Supabase *and* to google.com/1.1.1.1, so this isn't a Supabase-specific block). The only
other network-capable tool (`web_fetch`) is GET-only with a strict URL-length cap, so it can't
carry the POST body + `apikey` header an RPC call needs (I confirmed this by trying — a
`GET .../rpc/app_login?apikey=<key>&p_username=...` was rejected as "URL exceeds maximum
length" before it ever reached Supabase). **Everything below is code-trace-confirmed, not
live-confirmed**, except where I explicitly say a live check is the only way to know. No test
records were created (see "Test records created" section).

---

## Summary

The happy path works: all 7 in-scope screens have a working button → JS handler → RPC call,
and every RPC name I traced in this scope (`app_temp_points`, `app_temp_log_save`,
`app_temp_history`, `app_checklist_items`, `app_checklist_toggle`, `app_inventory_list`,
`app_inventory_count_save`, `app_inventory_request`, `app_inventory_requests`,
`app_supply_create/list/detail/advance/fulfill/item_set/receive/catalog*`, `app_form_insert`,
`app_admin_dashboard_list/update_status`, `app_list_get/save/delete`) **is present in
`rpc_manifest.json`** — no dangling/typo'd RPC names found in this scope, which is the #1
failure mode `API_REFERENCE.md` warns about. That's the good news.

The bad news is concentrated in exactly the areas the owner is worried about: forms that can
silently strand the user with no way forward, one feature that may be completely non-functional
due to a value mismatch, a "safety checklist" that enforces no safety checks, and three
different half-overlapping "ask for supplies" systems. Details below, worst first.

---

## Blockers

### B1. Shift Checklists may never show manager-added items — vocabulary mismatch (UNVERIFIED, verify first)
**Confidence: high from code; not DB-confirmed. This is the single highest-value thing to
click-test before launch, because if true it silently breaks a daily, Staff-facing, in-scope
feature for every store, every day.**

- The Admin Console's checklist-item editor (`Manage Lists → Shift checklist items`) stores a
  shift value that is one of the literal, capitalized strings `Opening` / `Closing` / `Cleaning`.
  Confirmed in two independent places:
  - HTML: `index.html:2272` — `<select id="admListShift"><option>Opening</option><option>Closing</option><option>Cleaning</option></select>` (no `value=`, so the option value *is* the capitalized text).
  - SQL: `admin_lists.sql:33-35` — `insert into public.checklist_items(label,shift_type,...) values (p_fields->>'name', coalesce(nullif(p_fields->>'shift',''),'Opening'), ...)`. Default is also `'Opening'`.
- The **crew-facing** Shift Checklists screen (`checklistsView`, `index.html:814-830`) uses tab
  buttons `onclick="setChecklistTab('open')"` / `'close'` / `'clean'` (lower-case, truncated —
  `index.html:823-825`). `setChecklistTab()` sets `clShift` to that exact string and
  `loadChecklist()` calls `supabaseClient.rpc('app_checklist_items',{...,p_shift:clShift,...})`
  (`js/06_disciplinary_actions.js:549-558`).
- So the admin tool writes `shift_type = 'Opening'` and the crew screen queries
  `p_shift = 'open'`. **If the `app_checklist_items` Postgres function does a plain
  `where shift_type = p_shift` (the normal/naive way to write this), zero rows will ever
  match**, and every store's Opening/Closing/Cleaning tab will permanently show "No checklist
  items configured for this shift yet — managers can add them in Admin" even after a manager
  adds items — and the empty-state message will make the manager think *they* did something
  wrong, when actually the item is sitting in the table under the wrong-cased key.
- I could not find the source of `app_checklist_items` anywhere in this repo (only
  `admin_lists.sql`'s `app_list_get`/`app_list_save`/`app_list_delete`, which are different
  RPCs used only by the Admin Console list, exist here) — consistent with `API_REFERENCE.md`'s
  own statement that "the database is the truth," not the repo. I cannot rule out that the
  function does `lower(shift_type) like lower(p_shift)||'%'` (which would coincidentally work,
  since "open" is a prefix of "opening", etc.) — but that's an unusual way to write a filter,
  so I would not bet on it.
- **30-second live test to resolve this:** as `test_admin`, add a checklist item via Admin
  Console with shift "Opening." As `test_crew` (or `test_admin`), open Shift Checklists →
  Opening tab. If the item doesn't appear, this is confirmed and is launch-blocking for this
  feature. **Fix is small either way** (normalize the value on one side or the other, or make
  the RPC compare case-insensitively/prefix-insensitively) but must be done with the same
  discipline `API_REFERENCE.md` asks for (additive migration, update every caller together).

---

## High-priority issues

### H1. Submit buttons get permanently stuck on any backend save error — no retry, and one message is actively false
Affects: **Store Pop-In Inspection**, **Vehicle & Trailer Check-Out**, **Vehicle/Trailer
Damage** (and, just outside this scope, Report-a-Repair/Maintenance) — i.e., every form still
on the older "generate PDF → save row" pattern.

- All of these funnel through `saveToSupabase()` (`js/10_my_maintenance_submissions.js:308-319`),
  which calls `app_form_insert`. If that RPC call errors or the network drops
  (`.catch()` at line 318), the function only shows an `alert()` and returns. **Nothing ever
  re-enables the submit button or resets its text.** The caller (`submitAudit`,
  `submitDriverForm`, `submitDamage`, `submitMaintenance`, `submitShortage`) only re-enables the
  button *inside* the success callback, which never runs on error. Result: the button is stuck
  reading "Saving…" / "Generating PDF…", disabled, forever — the only way out is reloading the
  page, which for Driver/Damage/Maintenance loses every field typed (no draft-save on those
  forms — see H2/M2 below).
- I checked for a safety net (a global `window.onerror`/`unhandledrejection` handler that might
  reset buttons) — there is none anywhere in the app.
- **For Pop-In specifically the error message is also factually wrong.** `submitAudit()`
  (`js/10_my_maintenance_submissions.js:387-428`) was rewritten to be "DB-first" (comment at
  line 405-406: "save the inspection to Supabase before attempting the Apps-Script PDF, so a
  PDF-server hiccup can never lose the inspection data") — it calls `saveToSupabase()` *before*
  the PDF email step. But `saveToSupabase()`'s generic error text still says **"PDF was emailed
  BUT failed to save to dashboard"** (`line 316`) — which, for Pop-In, is backwards: nothing was
  emailed yet, and more importantly *the inspection was not saved at all*. A manager reading
  that alert has every reason to believe their walk-through was captured somewhere when it
  wasn't. (For Driver/Damage/Maintenance the message is at least accurate, since those call
  the PDF step first — but they still leave the same stuck button.)
- **This is precisely the "getting stuck" failure mode the owner called out**, and it's not a
  hypothetical: it fires on any transient network hiccup or backend error, which is exactly
  when a manager is most likely to also be under time pressure (mid-inspection, mid-vehicle
  checkout).

### H2. Pop-In form does not reset after a successful submission unless you tap the specific "print" button
- `openPopIn()` (`js/05_admin_tasks_pip_disciplinary.js:366-373`) never clears the form — it
  just shows the view and calls `checkForDraft()`. `triggerTransition()`
  (`js/03_settings_account.js:116`) is a pure loading-spinner wrapper, confirmed no reset logic.
- On success, `submitAudit()` sets the button to "SENT! (TAP TO PRINT)" and wires
  `btn.onclick = _popInPrint`, which does `document.body.innerHTML = pdfHtml;` then
  `window.print(); location.reload();` — the *only* code path that clears the form is this
  full-page nuke-and-reload, triggered by one specific extra tap.
- `popInView` has a "← Back to Hub Menu" button visible the entire time (`index.html:1854`,
  standard on every view). If a manager taps that instead of "TAP TO PRINT" — a completely
  natural thing to do once you've seen "SENT!" — `openMenu()` just hides the view via CSS; it
  does not reset any of the 51 radios, the 4 header fields, the notes, or the photo previews.
  **Reopening Pop-In for the next store shows the previous inspection's answers still
  selected**, including a progress bar/score/status that reads as a complete inspection
  (`updateProgressBar`/`calc()` are only ever re-run on user input, never on `openPopIn()`).
  A manager could easily submit a second inspection that is really a re-submission of the first
  one's answers, mis-attributed to the wrong store/date, if they don't manually clear every
  field. `checkForDraft()` won't warn them either, since the draft was already cleared on
  successful submit (`localStorage.removeItem('calichesDraft_popIn')`).
- This is an **inconsistency with its sibling forms**: `submitDriverForm`, `submitDamage`, and
  `submitMaintenance` all explicitly call `form.reset()` (and clear photo arrays) and
  auto-navigate to `openMenu()` a few seconds after success
  (`js/10_my_maintenance_submissions.js:441, 843, 827`) — Pop-In is the odd one out, and it's
  the one form the owner specifically flagged to check end-to-end.
- **Fix:** reset the 51 radios/notes/photo arrays and re-run `generatePopInQuestions()`-equivalent
  cleanup at the top of `openPopIn()` (or right after a successful save), matching the other
  three forms.

### H3. Inventory Count's "Request" button is a dead end — no way to ever resolve it
- Inside the (management-only) Inventory Count screen, each low-stock item has a **Request**
  button (`js/06_disciplinary_actions.js:621`, handler `requestInv` at line 639-648) that
  prompts (via a plain `prompt()` dialog, not a form) for qty/note and calls
  `app_inventory_request`. These show up in a separate "Pending requests" modal
  (`openInvRequests()` / `app_inventory_requests`, lines 650-667, `index.html:852-859`).
- I grepped the entire codebase for every call site of `app_inventory_request` and
  `app_inventory_requests` — there are exactly two: the one that **creates** a request and the
  one that **lists** them. **There is no RPC or button anywhere that marks one fulfilled,
  closes it, or removes it from the list.** The empty-state copy ("No pending requests. 🎉")
  implies this list is supposed to empty out over time; nothing in the code makes that happen.
  In production this list can only grow, and a manager has no way to tell an actioned request
  from an ignored one except institutional memory.
- This is a second, separate "ask for supplies" pathway that coexists with the full Supply
  Request module — see H4.

### H4. Three different, inconsistent "ask for supplies" systems are live at once
1. **Supply Request** (`supplyRequestView`, `btn-shortage` → `openSupplyRequest()`,
   `js/10_my_maintenance_submissions.js:672-792`) — the current, full-featured one: New
   request / My requests / manager Incoming / Catalog tabs, a real status timeline
   (`supplyRenderDetail`, line 455-484: Submitted → Assigned → Fulfilling → In transit →
   Received → Closed), fulfillment notes, item-level substitute/fulfilled-qty tracking, CSV
   export. This is genuinely well built.
2. **Inventory Count's inline "Request"** (`app_inventory_request`, H3 above) — a totally
   separate, dead-end pipe with no status, no timeline, no catalog tie-in, and browser
   `prompt()` UX that doesn't match the rest of the app.
3. **The old "Store Shortage Report"** (`shortageView`/`submitShortage()`,
   `js/10_my_maintenance_submissions.js:799-812`, `index.html:1907`) — **orphaned**. I grepped
   every button/onclick in the live app and the only thing that opens `shortageView` is the
   archived `_archive/index.html.html` (the pre-rewrite version of the app). No live button
   calls `openForm('shortageView')` anymore — `btn-shortage` calls `openSupplyRequest()`
   instead (`index.html:327`). The form and its submit function are still fully wired and would
   work if something called them, they're just unreachable through normal navigation today.

A manager could easily miss a request logged through path 2 (it only surfaces in Inventory's
own modal, not in Supply Request's Incoming queue), and the Manager Dashboard still has a
"Shortages" tab (`index.html:999`, `fetchDashboard('Shortages',...)`) that is now permanently
stale — see "Stale-content candidates."

### H5. Vehicle & Trailer Check-Out's "pre-roll safety checklist" doesn't require any safety item to be checked
- `driverView` (`index.html:1904`) has six safety/equipment checkboxes: tire pressure/tread,
  lights, hitch/chains/electrical, fridge/freezer doors latched, custard/toppings secured, fire
  extinguisher/first-aid present. **None of the `<input type="checkbox">` elements have a
  `required` attribute**, and `submitDriverForm()`'s validation
  (`js/10_my_maintenance_submissions.js:432`) only checks
  `document.getElementById('vehicle').value` and `document.getElementById('signature').value`.
  A driver can leave all six boxes unchecked and the form submits successfully.
- This defeats the stated purpose of a "pre-roll safety checklist," and it's inconsistent with
  Pop-In's validation two files over, which refuses to submit unless all 51 items are answered
  (`js/10_my_maintenance_submissions.js:390-391`) — same app, same author, two very different
  bars for "complete."
- Competitor pattern (see below): DVIR-style fleet-inspection tools treat every checkpoint as
  pass/fail and require photo evidence specifically on a fail; Caliche's form doesn't even
  require a checkmark.

---

## Missing/incomplete features

- **No "decline/reject" action on Supply Request.** The Incoming-queue status filter
  (`js/10_my_maintenance_submissions.js:761`) lists `New, Submitted, Reviewing, Approved,
  Assigned, In transit, Received, Closed, Declined` — but the only status-changing RPC,
  `app_supply_advance`, only ever advances forward through a fixed 5-step map (`Submitted→
  Assigned→Fulfilling→In transit→Received→Closed`, defined identically at lines 457 and 743).
  `New`, `Reviewing`, `Approved`, and `Declined` never appear anywhere else in the codebase —
  they're unreachable from the UI. There is no way for office staff to reject a duplicate or
  not-going-to-fulfill request; it can only be marched forward or left sitting at "Submitted"
  indefinitely.
- **No return/check-in step for Vehicle & Trailer Check-Out.** The flow only checks a vehicle
  *out* (starting mileage, destination, purpose). There's no companion "check-in" capturing
  ending mileage/fuel/new damage, and no way to see whether a truck is currently out or has been
  returned. See Competitor-inspired ideas for the DVIR pattern this space normally uses.
- **No status visibility for the person who filed a Damage Report or Vehicle Checkout.**
  Compare: Maintenance has "My Submissions" with per-item status + manager notes + deadline
  (`openMySubmissions()`/`app_my_maintenance_submissions`); Supply Request has "My requests"
  with a full timeline. Damage Report and Vehicle Checkout have **neither** — once submitted,
  the crew member who filed it has no way to check on it again inside the app. Only managers
  see it, and only via the generic Manager Dashboard grid.
- **No offline handling anywhere in this scope.** If Wi-Fi/cell drops mid-shift (common in a
  walk-in cooler or on a vending route), any of these submissions hits the H1 stuck-button
  path with no local queue-and-retry. Only Pop-In has any local-storage safety net at all
  (its draft auto-save), and that's designed for resuming an interrupted fill, not for
  surviving a failed submit.
- **Vehicle/trailer/cart identity lists are hardcoded HTML, not admin-configurable.** Unlike
  positions, checklist items, inventory items, and temp points — all editable via Admin Console
  → Manage Lists (`js/09_work_orders_maintenance_phase.js:653-737`, backed by
  `app_list_get/save/delete`) — the truck/trailer options in `driverView` and the
  vehicle/trailer/cart options in `damageView` are literal `<option>` tags in `index.html`
  (lines 1904, 1913). Adding a new truck requires an `index.html` edit + deploy, not an in-app
  admin action.

---

## Stale-content candidates (hide, don't delete)

- **Manager Dashboard → "Shortages" tab** (`index.html:999`, `fetchDashboard('Shortages', this)`
  → `app_admin_dashboard_list` with `p_table:'shortages'`). Fed exclusively by the now-orphaned
  `shortageView`/`submitShortage()` (see H4). This tab will only ever show old, pre-rewrite
  data and will never receive a new row again. A manager scanning tabs for "did anyone report a
  shortage" could reasonably check this tab, see nothing (or old data), and miss that Supply
  Request (a completely different tab/view) is where new requests actually land. Recommend
  hiding the tab (or relabeling it "Shortages (archive)" / redirecting it into Supply Request)
  rather than deleting the `shortages` table's history.
- **`shortageView` / `submitShortage()` / `shortageForm`** (`index.html:1907`,
  `js/10_my_maintenance_submissions.js:799-812`) — dead code, unreachable from any live button.
  Low risk since nothing links to it, but worth removing once someone confirms no external
  bookmark/QR code still points at `openForm('shortageView')`.
- **Inventory "Pending requests" list** (H3) — not stale in the sense of wrong data, but it will
  silently accumulate forever with no way to distinguish "handled outside the app" from
  "forgotten." Worth flagging to whoever manages the Inventory screen day to day.

---

## Competitor-inspired ideas

Grounded in current (2026) feature pages/reviews for Jolt and Zenput/GoSpotCheck (now "FORM"),
plus DVIR/fleet-inspection and restaurant-inventory tooling for the vehicle- and par-level-
specific pieces.

1. **Require a checkmark + photo specifically on failed safety items, not just "attach a photo
   somewhere."** DVIR-style fleet apps (Simply Fleet, FleetRabbit, Oxmaint) mark each inspection
   point pass/fail and require photo evidence *only when it fails*, which prevents
   "pencil-whipping." Apply this to Vehicle Check-Out's six safety checkboxes (H5) — right now
   they're optional and have no photo capture at all, while Damage/Maintenance/Pop-In already
   have photo upload wired up, so the plumbing exists, it's just missing from Check-Out.
2. **Multi-channel alerts on out-of-range temps and critical issues, with a resolution
   notification back to the person who flagged it.** Jolt pushes out-of-range temp alerts via
   push/text/email to management immediately, and Zenput notifies field managers on critical
   audit findings *and* notifies the reporter once the issue is resolved (closes the loop).
   Caliche's `saveTempReading()` (`js/06_disciplinary_actions.js:507-513`) only shows a
   client-side `alert()` claiming "Management has been notified" — I could not confirm from the
   frontend whether a real push/SMS/email actually fires server-side. Worth verifying, and worth
   adding a "resolved" ping back to whoever logged the failed reading.
3. **Offline queue-and-sync.** This entire software category treats spotty retail Wi-Fi as a
   given — reviewers call out Zenput's lack of offline support as a real limitation, while
   GoAudits/Simply Fleet advertise offline capture as a selling point. Extend the pattern
   Pop-In's draft-save already uses (write to `localStorage`, sync when back online) to all the
   one-shot forms in this scope, and specifically make it the recovery path for the H1
   stuck-button bug instead of a dead end.
4. **Auto-generate a Supply Request straight from a low/at-par Inventory Count line**, the way
   MarketMan/Rezku/Square/Toast trigger reorder suggestions the moment on-hand drops below par.
   Right now Inventory Count's own "Request" button routes to a *third*, dead-end system (H3/H4)
   instead of just pre-filling a Supply Request with that item/store — one system, one queue,
   one status timeline for every supply ask, and Inventory's low-stock flag becomes the trigger
   instead of a parallel universe.
5. **Pair Check-Out with a Check-In / return step**, DVIR-style: ending mileage, fuel level, "any
   new damage since checkout," feeding the same mileage number into the existing "Vehicles &
   Service" tracker (`btn-vehicles` / `openVehiclesService()`, `js/05_admin_tasks_pip_
   disciplinary.js:597,653`) instead of that tracker's mileage living in a completely separate
   data entry point from Check-Out's "Starting Mileage" field. This also gives a Damage Report a
   natural "was this found during your last checkout?" reference.

Sources consulted:
- [Food Safety Software | Jolt Software](https://www.jolt.com/lp/food-safety-software/)
- [Automate Your Food Safety Time & Temperature Logs (Jolt)](https://get.jolt.com/products/time-temperature-logs/)
- [Audits & Corrective Actions | Zenput](https://www.zenput.com/platform/audits-corrective-action)
- [Platform Overview | Zenput](https://www.zenput.com/platform)
- [AI Info | GoSpotCheck](https://www.gospotcheck.com/about/ai-info)
- [Best Zenput Alternatives for Multi-Unit Operations Teams (Xenia, 2026)](https://www.xenia.team/articles/zenput-vs-jolt)
- [DVIR App: Streamline Vehicle Inspections (Simply Fleet)](https://www.simplyfleet.app/solutions/dvir-app)
- [Automated Pre-Trip Inspection App for Trucking: DOT Compliant DVIR 2026 (FleetRabbit)](https://fleetrabbit.com/article/automated-pre-trip-inspection-app-trucking)
- [Driver Vehicle Inspection Report (DVIR) for Fleet Facilities (Oxmaint)](https://oxmaint.com/industries/facility-management/driver-vehicle-inspection-report-for-fleet-facilities)
- [The Best Restaurant Inventory Management Software for 2026 (Rezku)](https://rezku.com/blog/best-restaurant-inventory-management-software/)
- [AI-Powered Inventory Management Software for Restaurants (MarketMan)](https://www.marketman.com/platform/restaurant-inventory-management-software)

---

## Test records created

**None.** As explained at the top, this environment's shell tool has no outbound network route
to Supabase (confirmed: empty `resolv.conf`, no default route, `curl` exit 56 / status 000 to
`ikgbihwkqhsfahnswfbz.supabase.co` and to unrelated hosts like google.com/1.1.1.1 — a sandbox
limitation, not a Supabase-specific block), and the alternate fetch tool available to me is
GET-only with a URL-length cap that can't carry the POST body + header an RPC call needs (I
verified this by trying an `app_login` call and getting the fetch tool's own "URL exceeds
maximum length" error before it reached Supabase). I was not able to submit the suggested test
Supply Request (`test_crew` → confirm in `test_admin`'s Incoming queue) or exercise any other
live flow. **Whoever can run this from a machine with real network access should do so before
launch** — it's a 2-minute check and would also resolve Blocker B1.

---

## Open questions for Issac

1. **B1** — please run the 30-second live test described above (add a checklist item as
   Opening via Admin Console, check whether it shows on the crew Opening tab) before anything
   else in this report. Everything else here is secondary to that.
2. Is **"Store & Site Inspection"** (`js/20_site_inspection.js`, a separate manager-only tool
   with admin-configurable sections, 1-5 scoring, required photo evidence on low scores, and its
   own leadership dashboard) meant to eventually replace **"Store Pop-In Inspection"** (the fixed
   51-question form this audit covers), or are both intentionally permanent, parallel tools?
   They're built independently (different tables, different RPCs — `insp_*` vs `pop_ins`/
   `app_form_insert`) and a manager searching for "inspection" would find both with no
   in-app explanation of when to use which.
3. For Inventory's dead-end "Request" pipe (H3): was a fulfill/close step ever built
   server-side and just never wired to a button, or does it genuinely not exist in the DB
   either? Worth a quick check for an unused RPC before deciding whether to build one or just
   retire this pathway in favor of Supply Request (see idea #4).
4. Should Vehicle Check-Out's six safety checkboxes become required (H5), matching Pop-In's
   all-51-required rigor? And should photo capture be added there, matching Damage/Maintenance/
   Pop-In?
5. OK to hide (not delete) the Manager Dashboard's "Shortages" tab and retire the orphaned
   `shortageView`/`submitShortage()` code now that Supply Request has fully replaced it?
6. Minor: `API_REFERENCE.md` (line 36) says the Supabase anon key lives "in index.html (~line
   2575)" — `index.html` is only 2,509 lines total; the key actually lives in
   `js/01_part01.js:2-5`. Small thing, but that doc's whole purpose is being the accurate
   "don't break it" map, so flagging it while I'm here.
7. Low-confidence, not chasing further without a real account to test: `applyRoleUI()`
   (`js/05_admin_tasks_pip_disciplinary.js:442`) treats role string `'Store Manager'` as
   management for tile visibility, but the function-level gate on Pop-In/Inventory
   (`isMgmt()`, `js/04_employee_roster.js:873`) checks a *different* signal
   (`currentUser.isStoreManager`, a boolean derived from per-store assignments in
   `js/07_assignable_tasks_messaging.js:19`, not the role string). I could not find `'Store
   Manager'` as an assignable option in the role dropdown I did find
   (`js/10_my_maintenance_submissions.js:127`), so this may be dead code from before the
   per-store flag existed — but if any real account has role text `'Store Manager'` without the
   matching flag, they'd see the Pop-In/Inventory tiles but get turned away when they tap them.
   Worth a glance, not urgent.
