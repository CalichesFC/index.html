# Admin Dashboards, Reporting & Config — Launch Audit

**Scope:** Manager Dashboard, Store Intelligence, Live Dashboard, Store Scorecards, Maintenance
Leadership Dashboard, Daily Sales & Labor, Weekly Prime Cost, Shortage Trends, Settings & Console,
Business Settings, Roles & Permissions, Marketing Command Center, Monthly Ops Meeting Hub.

**Method:** Read-only static code tracing through `index.html` and `js/01`–`js/27`, cross-checked
every RPC name found against `rpc_manifest.json`. **Live verification was not possible.** This
sandbox's shell has no general network egress — `curl` to Supabase, GitHub, and even `google.com`
all returned `403 blocked-by-allowlist` from a mandatory local proxy, and the `web_fetch` tool
cannot send the `apikey` header Supabase's REST/RPC endpoints require. No login attempt, no test
records, and no network calls were made against the live project. Everything below is from reading
the code that ships to production, so "confirmed" means "confirmed in source," not "confirmed by
observing it run." Items that specifically need a live check are called out.

---

## Summary

**Yes — there is real fake/illustrative data presented on a live-looking screen.** The Live
Dashboard's "Square · Mobile Vending Trends" and "Catering — Text-to-Pay" sections
(`js/06_disciplinary_actions.js` lines 730–811) are 100% hardcoded sample arrays with **zero**
backing RPC or network call — invented town names, invented customer names, invented dollar
figures — sitting directly under a pulsing green "live" dot and the header "NCR PULSE · Store
Operations — live across 5 locations." The only disclosure is one small gray sentence at the very
bottom of the page. This is exactly the "looks live but isn't" risk called out in the brief. Full
detail in Blockers #1.

Beyond that headline item, the deeper and arguably more consequential problem this audit found is
**silent role-gating breakage**: employees promoted to "Shift Leader" or "Assistant Manager" through
the Employee Roster's own sanctioned promotion flow lose access to tools they should have, with no
error shown anywhere (Blocker #2). Also found: a Manager Dashboard date filter that does nothing
(High #3), a Roles & Permissions screen that can't actually control ~12 of the tools it's supposed
to govern (High #4), and a "Delete" button on the Users tab whose wording contradicts the app's own
"records are retained, not deleted" policy (High #6).

**On the positive side:** every other screen in scope — Manager Dashboard's five submission tabs,
Store Scorecards, Maintenance Leadership Dashboard, Daily Sales & Labor, Weekly Prime Cost
(including the Axial auto-fill), Shortage Trends, Settings & Console (contacts, lists,
notifications, checklist due times, contacts directory, data retention, duplicate scanner),
Business Settings, and the Monthly Ops Meeting Hub — is genuinely wired to real RPCs with sane
empty states, and every RPC name traced from these screens (60+ distinct names) **was found in
`rpc_manifest.json`**. That's a real vote of confidence in most of this section; the problems are
concentrated, not systemic.

**Store Intelligence "Manager" vs "Leadership" — same screen, confirmed.** They are not two
different screens. Both tiles (`commandCenterBtn` and `btn-commandCenter`, `index.html` lines 383
and 405) call the identical `openCommandCenter()`, which opens the identical `ccModal` overlay and
calls the identical `app_command_center` RPC. The only difference is which role list each tile's
*visibility* check uses — and that difference is itself the source of Blocker/High #5 below.

---

## Blockers

### 1. Live Dashboard: Square vending & catering figures are 100% fabricated, minimally disclosed
**File:** `js/06_disciplinary_actions.js` lines 730–811 (comment on line 730 literally reads
`// ADMIN LIVE DASHBOARD — NCR Pulse + Square (placeholder data)`)

- `AD_ROUTES` (rendered under "📡 Square · Mobile Vending Trends") is a hardcoded JS array: Deming
  (1,840 cups, $5,260), Hatch (1,320 cups, $3,910), Silver City (1,610 cups, $4,720).
- `AD_CATER` (rendered under "🎉 Catering — Text-to-Pay") is a hardcoded JS array: "Sanchez Wedding"
  (Las Cruces, $1,450), "NMSU Grad Bash" (Las Cruces, $980), "Spaceport Mixer" (T or C, $1,720),
  "Quinceañera — Reyes" (Deming, $640).
- Neither array is ever populated from a network call — `adRender()` (line 798) builds their HTML
  directly from the static arrays with no `supabaseClient.rpc(...)` in between. Confirmed no
  Square-related RPC exists anywhere in `rpc_manifest.json` either.
- The town names don't even match the chain's real 5 stores. `HUB_STORES` (`js/03_settings_account.js`
  line 211) is `['Roadrunner','Valley','Lenox','Alamogordo','Roswell']` — used consistently as the
  fallback store list everywhere else in the app (Command Center, Scorecards, etc.). Deming, Hatch,
  Silver City, Las Cruces, and "T or C" appear nowhere else in the codebase as real locations. This
  reads as leftover prototype/demo content that was never swapped for real data or removed.
- **The only disclosure** is one line of 12px gray text at the very bottom of the whole page
  (`index.html` line 910): *"Store sales & labor above are live from your Daily Sales & Labor
  entries (refreshes every minute). Square & catering figures below are still illustrative."* There
  is no "DEMO DATA" badge on the sections themselves, and the screen's own header claims data is
  "live across 5 locations" (`index.html` line 903) — directly above the fake content.
- By contrast, the NCR Pulse section directly above it *is* real: `adLoadNcr()` (line 759) calls
  `app_sales_recent` per store and correctly shows "No sales entered yet" for stores without data.
  That makes the fake section look even more like real data by association — same visual language,
  same page, same "live" framing, one is real and one isn't.

**Why Blocker:** this is precisely the "looks live but isn't" failure mode the owner is worried
about, on a screen literally called "Live Dashboard," reachable by any Admin Manager. A manager
glancing at pretty bar charts and dollar totals has no reason to doubt them.

**Recommendation:** before launch, either (a) build the real Square integration and wire these
sections to a real RPC, or (b) hide both sections entirely until that exists, or, at minimum,
(c) replace the invented content with an obvious "Coming soon" state and move the illustrative
disclosure onto each section (not just page-bottom fine print).

### 2. Role-string mismatch silently breaks promoted Shift Leaders and Assistant Managers
**Files:** `js/04_employee_roster.js` line 173 (promotion ladder) vs. lines 795, 873 and
`js/05_admin_tasks_pip_disciplinary.js` lines 467–489 (permission gates)

- The Employee Roster's own "Change role" flow (`empManageHtml`, the sanctioned, audit-logged way
  to promote someone) offers this ladder: `['Crew Member','Crew Trainer','Shift Leader','Assistant
  Manager','Store Manager','Admin Manager']`. Selecting a role here calls `app_emp_promote` with
  that exact string.
- But most of the app's permission checks test for the string **"Shift Lead"** (no "er"), not
  "Shift Leader":
  - `permDefault()` (`js/04` line 795): `var sl=(role==='Shift Lead')` — feeds the Roles &
    Permissions matrix's default on/off state for Discipline, Attendance, Pre-Shift, Availability
    Approvals, Celebrations, Crew Trainer, Pop-In, and Inventory.
  - `isMgmt()` (`js/04` line 873): `currentUser.role==='Shift Lead'` — the broad gate that unlocks
    Pop-In and Inventory specifically for "Shift Lead and above" per its own comment.
  - `applyRoleUI()` (`js/05` lines 467, 469, 471, 473, 475, 477–481, 489): eight separate tile-visibility
    checks use `role === 'Shift Lead'` with no "Shift Leader" variant.
  - Confirmed by exhaustive grep: **zero** exact `role === 'Shift Leader'` checks exist anywhere in
    the codebase. Only `js/05_admin_tasks_pip_disciplinary.js` has a handful of *newer* gates
    (Daily Report, Shift Console, Site Inspection, Performance Write-Ups) that were patched to
    accept **both** `'Shift Lead'` and `'Shift Leader'` in an OR-list — proving a developer noticed
    this ambiguity at some point but didn't retrofit the older, more numerous gates.
- Net effect: an employee promoted to "Shift Leader" through the Roster today gets Daily
  Report/Shift Console/Site Inspection/Write-Up access, but is **silently denied** Disciplinary
  Actions, Attendance, Pre-Shift Lineup, Availability Approvals, Celebrations, Pop-In, Inventory,
  and Crew Trainer — all tools a shift leader needs — with no error anywhere. It just looks like
  those tiles were never turned on for them.
- **"Assistant Manager" is worse: it is not recognized by any permission check in the app at all**
  (`isManagerRole()` in `js/04` line 870 only recognizes `'Admin Manager'`, `'Manager'`,
  `'Vice President/Co-Owner'`, plus `is_developer`). Promoting someone to "Assistant Manager" via
  the Roster's own ladder appears to strip them down toward line-staff-level tool access.
- The Roles & Permissions matrix can't fix this either: `PERM_ROLES` (`js/04` line 783) — the list
  of roles that screen can configure — contains `'Shift Lead'` but not `'Shift Leader'`, and
  contains neither `'Assistant Manager'`.

**Unconfirmed:** whether `app_emp_promote` normalizes the string server-side before storing it —
no SQL file for this RPC exists in the repo (only in the live DB), and I have no live DB access to
check. Even if it does normalize "Shift Leader," the "Assistant Manager" gap stands regardless,
since no code path recognizes that string under any spelling.

**Why Blocker:** this breaks a core, frequently-used, already-shipped workflow (promoting staff)
completely silently, via the app's own intended mechanism, for two of six ladder rungs.

**Recommendation:** pick one canonical spelling (recommend keeping "Shift Lead" since it's the
majority string) and normalize the Roster's ladder to match; add "Assistant Manager" to every gate
that should include it, or map it to `isManagerRole()`/`isMgmt()` explicitly. Then do a one-time
data check for any employee currently stored with role exactly `"Shift Leader"` or `"Assistant
Manager"` and re-verify their tool access.

---

## High-priority issues

### 3. Manager Dashboard's date filter does nothing
**Files:** `index.html` lines 1006–1013 (`dashDateFilter` select), `js/10_my_maintenance_submissions.js`
lines 47–92 (`fetchDashboard`)

The Pop-Ins / Shortages / Driver Logs / Maintenance Logs / Damage Reports tabs all show a "Filter:
Last 7 Days / Last 30 Days / All Time (Max 50)" dropdown (`id="dashDateFilter"`, defaults to "Last
30 Days"). Confirmed by exhaustive grep: **`dashDateFilter` appears exactly once in the entire
codebase — its own `<select>` tag.** `fetchDashboard()`, the function that runs on every tab click
and every filter change, calls `app_admin_dashboard_list` with only `p_admin_username`,
`p_admin_password`, and `p_table` — the filter's selected value is never read, never passed. Picking
a different filter option just silently re-fetches the exact same query. Managers relying on this
control to scope what they're reviewing are looking at whatever the RPC returns by default (likely
everything, unfiltered — I could not verify the server-side default without DB access). Contrast
with Shortage Trends (`js/11_customer_history_autosuggest.js` lines 416–472), which implements the
identical 7/30/90/All-Time pattern correctly by filtering the fetched dataset client-side — proof
this isn't a technical limitation, just an oversight on this one screen.

### 4. Roles & Permissions matrix can't actually control ~12 of the tools it should
**File:** `js/04_employee_roster.js` line 782 (`PERM_FEATURES`) vs. actual `permAllow()` call sites
across the app

`PERM_FEATURES` — the list that drives every toggle shown on the "Roles & Permissions" screen — has
28 entries. But 39 distinct feature IDs are actually gated via `permAllow(fid, ...)` throughout the
app. The 12 missing from the matrix: `catering`, `daily_report`, `marketing`, `marketing_v2`,
`ops_meeting`, **`pay_tools`**, `requests_rails`, `shift_console`, `site_inspection`, `team_growth`,
`training_hub`, `writeup_templates`. An Admin Manager who wants to restrict, say, Pay Tools
("Approved raises, payroll impact & promotion-ready queue") for a role has no toggle to do it —
the screen's own copy ("Choose a role, then turn its tools on or off") over-promises what it
covers. This is a config screen that looks complete but silently isn't for about a third of the
real gates.

### 5. "Store Intelligence" tile is shown to a role that then gets locked out
**Files:** `js/05_admin_tasks_pip_disciplinary.js` lines 452 & 506, `js/26_command_center.js` line 35

`applyRoleUI()` shows the visible "Store Intelligence — Leadership" tile (`btn-commandCenter`) to
`isManager || ['Vice President/Co-Owner','Store Manager','Office'].indexOf(role)>=0` — i.e., it
explicitly includes the `'Office'` role. But the destination screen's own gate,
`ccCanSee()` (`js/26_command_center.js` line 35), only allows `is_developer`, `isManagerRole()`
(Admin Manager/Manager/Store Manager/VP), or a role string containing "manager", "admin", "lead",
"owner", or "vp" — `'office'` matches none of these. Anyone with role `'Office'` who clicks the tile
they were shown gets the alert *"The Command Center is for managers and leadership"* — a dead end.
The same `'Office'` inclusion (and the same underlying gap) also applies to the Marketing, Daily
Report, Shift Console, Ops Meeting, and Pay Tools tiles (all use the identical
`[...,'Office']`-in-the-OR-list pattern at lines 495–507) — worth checking each of those
destination screens' own internal gates too. Note: `'Office'` is not in `PERM_ROLES` (line 783) and
is not offered in any role dropdown I found in the roster or Users tab — **unconfirmed whether any
current employee is actually assigned this role** (I have no DB access to check; flagged as an open
question below).

### 6. "Delete" on the Users tab contradicts the app's own retention policy — needs verification
**Files:** `js/10_my_maintenance_submissions.js` lines 160–169 (`deleteUser`), `js/04_employee_roster.js`
line 706 (`app_emp_set_active`), Data Retention copy at `index.html` line 2257

The Manager Dashboard's Users tab has a red "Delete" button whose confirm dialog reads *"Are you
sure you want to permanently delete this user?"* and calls `app_admin_delete_user`. Meanwhile the
Employee Roster has a proper soft-deactivate (`app_emp_set_active`, toggling an `active` flag), and
the Admin Console's Data Retention card states outright: *"Records are archived, never
hard-deleted."* If `app_admin_delete_user` performs an actual SQL `DELETE` (which the wording
strongly implies and which I cannot rule out without DB access), it directly contradicts the
retention promise the owner cares about, and could orphan discipline records, notes, timesheets, or
schedule history that reference that user's ID. Two different employee-management screens
(Users tab vs. Roster) with two different edit flows, two different role vocabularies (see
Blocker #2), and two different "make this person go away" mechanisms is itself a sign these two
screens should be reconciled into one before launch.

### 7. Marketing Command Center v1 — manifest itself flags possible incomplete deployment (unconfirmed, needs live check)
**File:** `rpc_manifest.json` line 558

The manifest's own trailing note reads: *"mkt_* added 2026-07-09; marketing_command_center.sql
queued in DEPLOY_STEPS_2026-07-13.md paste list (was blocked 7/9: Supabase editor down). Once
pasted, js/13 v1 is fully live behind the single openMarketingHub door."* The code side is
fully built (`js/13_marketing.js`, `js/27_marketing_v2.js`, all `mkt_*`/`mkt2_*` calls present in
the manifest) — but this note suggests there was, as of manifest generation (2026-07-14),
unresolved doubt about whether the backing SQL had actually been pasted into the live database. I
could not verify this live (no network egress in this sandbox — see Method). **Action:** run the
health-check query in `API_REFERENCE.md` §6 against the live DB, or just click into Marketing
Command Center as a real manager and confirm the dashboard loads without errors.

---

## Missing/incomplete features

- **Duplicate Employee Scanner is detection-only.** `openDupScan()` (`js/01_part01.js` line 625)
  calls the real `app_emp_dupscan` RPC and returns genuinely scored name-similarity pairs — this is
  not fake. But its own copy says: *"Pairs of roster names that look similar — for review only.
  Nothing is changed or merged here... (Safe merge & rehire tools come next.)"* There is currently no
  in-app way to act on a found duplicate (merge, mark as rehire, archive one side) — an admin has to
  go fix it manually outside the Hub. Honestly disclosed, but still an open loop.
- **Prime Cost "Auto-fill from Axial / POS feed"** (`pcAutofill`, `js/06_disciplinary_actions.js`
  line 872) is real and pulls from `app_sales_detail`/`app_sales_recent` — but that's the *Daily
  Sales & Labor* feed, not a direct live Axial pull for every store. Since only Roadrunner
  auto-syncs from Axial (see Medium #8 below), for the other 4 stores this button really "auto-fills
  from whatever a manager already typed into Daily Sales & Labor," which is accurate but the button
  label doesn't make that distinction. The in-app message when data is missing is honest and clear,
  so this is more a labeling/expectation issue than a functional gap.
- **Two separate employee role-editors** exist with non-overlapping role option lists: Manager
  Dashboard → Users tab (`Blue Apron, Shift Lead, Manager, Maintenance, Admin Manager` [+VP]) via
  `app_admin_update_role`, and Employee Roster → Change Role (`Crew Member, Crew Trainer, Shift
  Leader, Assistant Manager, Store Manager, Admin Manager`) via `app_emp_promote`. Neither list is a
  superset of the roles actually referenced in permission code (`Finance Approver`, `Maintenance
  Lead`, `Crew Member` don't appear in the Users tab list at all). This overlaps directly with
  Blocker #2 and High #6.

---

## Stale-content candidates (old data / copy that should be revisited, not necessarily deleted)

- The Live Dashboard's `AD_ROUTES`/`AD_CATER` fake arrays (Blocker #1) — if a real Square feed isn't
  landing before launch, this content should be pulled rather than left live.
- `API_REFERENCE.md` line 36 says the Supabase anon key lives "in `index.html` (~line 2575)." It has
  since moved to `js/01_part01.js` lines 3–5; `index.html` is only 2,509 lines total now. Minor, but
  this doc is the team's own "don't break it" map and is dated 2026-07-09 while several `js/*`
  files carry mtimes through 2026-07-17 today — worth a quick refresh pass so it stays trustworthy.
- The "Only Roadrunner is syncing from Axial right now" disclosure (`js/26_command_center.js` line
  99) is a hand-written string, not derived from real integration-status data. It's accurate today
  but will silently go stale the moment a second store gets connected, unless a developer remembers
  to edit this exact sentence. Low risk, but worth a reminder/TODO wherever the next store's Axial
  sync gets turned on.

---

## Competitor-inspired ideas (light touch, per brief)

- **Toast's back-office reporting** gives multi-location operators a single-screen breakdown across
  all stores with consistent, centrally-refreshed reporting (hourly refresh cadence) rather than
  per-store drill-in only. Store Intelligence/Scorecards here are strong per-store views but there's
  no single "all 5 stores ranked side by side" table — worth considering once more stores are
  Axial-synced, so leadership can scan for outliers in one glance rather than paging through 5 cards.
  ([Toast Reporting](https://pos.toasttab.com/products/reporting), [Toast Now](https://pos.toasttab.com/products/toast-now))
- **MarginEdge's prime cost tooling** auto-calculates prime cost per location straight from POS +
  invoice data with no period-end wait, and auto-updates recipe/ingredient costs as invoices post.
  Caliche's Weekly Prime Cost is a well-built manual/semi-automated workbook (the Axial auto-fill
  for sales/labor is a good start) but ending inventory, food invoices, and manager wages are
  explicitly manual every week per the in-app copy. Not a pre-launch requirement, but a natural
  next phase once there's appetite for deeper POS/invoice integration.
  ([MarginEdge prime cost](https://www.marginedge.com/blog/how-to-manage-prime-costs-across-restaurant-locations), [MarginEdge multi-unit](https://www.marginedge.com/for-multi-units))

---

## Test records created

**None.** Per Method above, this sandbox has no network path to the Supabase project (proxy
allowlist blocks all outbound traffic, confirmed with `curl` returning `403 blocked-by-allowlist`
even for `google.com`), and the available `web_fetch` tool can't attach the required `apikey`
header for an authenticated POST to a Postgres RPC. No login was attempted (as `test_admin` or
otherwise), nothing was written to the database, and no other file in the repo was modified —
only this report.

---

## Open questions for Issac

1. **Live Dashboard Square/Catering**: is a real Square feed planned before launch, or should this
   section be hidden/relabeled "Coming soon" for the 30-day launch? (Blocker #1)
2. Can someone with DB access run: `select role, count(*) from users where role in ('Shift Leader',
   'Assistant Manager','Office') group by role;` — this would confirm whether Blocker #2 and High #5
   are currently affecting real staff, or are still theoretical. That single query would also tell
   you whether any current employee has ever been promoted to a role that's silently losing tool
   access right now.
3. Is `app_admin_delete_user` (Users tab "Delete") a hard `DELETE` or a soft flag? If hard, should it
   be removed in favor of the Roster's `app_emp_set_active` deactivate flow, consistent with the
   Data Retention promise? (High #6)
4. Can someone confirm live that Marketing Command Center v1 loads without RPC errors for a real
   manager account? The manifest's own note suggests this was an open question as of 2026-07-14.
   (High #7)
5. Which role string should be canonical going forward — "Shift Lead" or "Shift Leader"? Recommend
   picking one and sweeping the whole codebase, rather than continuing to patch individual gates
   with both spellings.
