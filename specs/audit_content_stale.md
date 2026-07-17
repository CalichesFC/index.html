# Content & Staleness Audit — Messages, What's New, Emergency, App-wide Sweep

**Auditor scope:** Messages/Announcements/Home feed/notifications · "What's New — How to Use It" page · Emergency Procedures · app-wide placeholder & stale-content sweep · competitor ideas.
**Date:** 2026-07-17 · Repo `C:\Users\issac\AppData\Local\CalichesHub-Clean` · read-only audit (no code changed).

**Verification method & limits (read this first):**
- All findings below were verified against the repo source (`index.html` + `js/*.js`, file:line cited).
- Live check: fetched `https://calichesfc.github.io/index.html` — the **deployed app text matches the repo exactly** (What's New content, Emergency banner, PandaDoc placeholder, Time Clock "Test mode" all confirmed live). `APP_VERSION = '2026.07.17.1001'` (`js/01_part01.js:7`).
- **Supabase REST could not be reached from this sandbox** (proxy 403 on `*.supabase.co`; web_fetch rejects the long anon-key URL). So DB-resident content — current announcement-bar text, Updates-feed posts, store-feed messages, `app_settings` group `emergency` values, training module list — is **unverified live**. Items depending on it are marked **[unconfirmed — DB]** with the exact query to run.

---

## Summary

The app's code and navigation are in better shape than expected for a placeholder sweep — there is no lorem ipsum, almost no TODOs, and every What's New feature I could statically check exists except two (details below). The real problems are concentrated in the **content layer**:

1. **Blocker:** the safety-critical Emergency Procedures screen ships with `[____]` where real phone numbers belong, plus an on-screen "being finalized" banner. The admin plumbing to fix it already exists and is a same-day fix.
2. **High:** the "What's New" help page is frozen at **June 25, 2026** — it's the app's only in-app documentation, it's missing every feature shipped July 9–14 (Daily Store Report, Shift Console, Training Hub Phase 1, Ops Meeting, Marketing v2, Write-Ups, Pay Tools, Command Center, password migration…), and at least three of its claims are now wrong or unfollowable.
3. **High:** three "unfinished-looking" strings are live for every user: Time Clock "Test mode — pick a test employee" (on the Home tab), the red "(needs a label / confirm link)" PandaDoc tile in Forms & Documents, and "Square & catering figures below are still illustrative" on the Live Dashboard.
4. **Medium:** the PIN→password migration left mixed terminology across login, register, settings, recovery and privacy text — the register form still tells new hires to "Create a 4-Digit PIN" while the app then demands 8-character passwords.
5. Announcements/Updates have **no age display and no expiry mechanism**, so date-bound posts will go stale on screen by design; the manager "Delete" on updates is a **hard delete**, which conflicts with the owner's "hide, never delete" rule.

Messages (Updates/Direct/My Store), the announcement bar, Home feed ("Needs You Today", My Day, recognition, Jump To) and the notification stack (bell, prefs matrix, push, badges) are **structurally complete and correctly wired** — no dead-end navigation found in this scope.

---

## Blockers

### B1 — Emergency Procedures: real phone numbers missing on a safety-critical screen ⛔
**Severity: Blocker (safety-critical missing information). Confirmed live on the deployed page.**

What a crew member sees today: the red **Emergency Procedures** tile on Home opens a screen with the banner *"🚧 Being finalized with management — phone numbers still being added."* and 9 scenario checklists (power outage, internet, card failure, severe weather, fire, robbery, machine failure, water, food safety) whose call-someone steps read literally **"Call the manager on call: [____]"**. In a real robbery or fire, the number is a blank.

**Exactly where it lives (fast-fix map):**
| Piece | Location |
|---|---|
| Banner text | `index.html:2338` (inside `#emergencyView`, `index.html:2330-2342`) — remove once numbers are in |
| Scenario checklists w/ `[____]` fallbacks | `js/08_availability.js:179-241` (`buildEmergency()`) — 13 blank slots across the 9 scenarios |
| Where blanks are filled from | `cfg('emergency', <key>, '[____]')` → `app_settings` table, group **`emergency`** (`admin_settings.sql:6-53`, RPCs `app_settings_get`/`app_settings_set`) |
| The 5 keys actually rendered | `manager_on_call` (appears in all 9 scenarios), `utility`, `internet`, `machine_vendor`, `water_utility` |
| Admin UI that fills them | Admin → **Business Settings** (`openAppSettingsAdmin`) → **Emergency Numbers** tab — `js/14_admin_config.js:86-94` (`AC_EMERG`), editor `:182-192`, saves via `acSaveEmergency()` |
| Separate "Key contacts" card on the same screen | reads `app_settings` group **`contacts`** via `app_settings_get` (`js/09_work_orders_maintenance_phase.js:794-812`); editable in Admin Console → "Key contacts & info"; cached in localStorage so it works offline |
| What's New cross-reference | `index.html:1750` — "**Still to do:** management fills in the real phone numbers where you see **[____]**" (remove this bullet too) |

**Fix = data entry, not code:** an Admin Manager fills six fields in Business Settings → Emergency Numbers and saves (or additive SQL upserts into `app_settings` group `emergency`), then delete the banner line `index.html:2338` and the What's New bullet at `:1750`. Already tracked as a known "needs Aaron" item in `MASTER_CHECKLIST.md:19-22`.

**Two adjacent defects found while verifying (fix in the same pass):**
- **Dead `police` setting:** the admin editor offers "Police (non-emergency)" (`js/14_admin_config.js:93`) but no Emergency screen text ever renders it — an admin can fill it and it shows nowhere. Either render it (e.g., in the robbery scenario / Key contacts) or drop the field. (Medium)
- **Literal "[2 hours]" placeholder:** power-outage step 6 reads *"If power is out more than [2 hours], check product temps…"* (`js/08_availability.js:187`) — bracketed template text that reads as another unfilled blank. Confirm the real food-safety threshold and remove the brackets. (Medium)
- **Numbers aren't tap-to-call:** scenario steps and Key contacts render numbers as plain text, not `tel:` links (`js/09:811`, `js/08` steps via `escapeHtml`). In an emergency, staff should tap once to dial. (Medium, see competitor ideas #3)
- **[unconfirmed — DB]** whether group `contacts` (Key contacts card) currently has any rows. Check: `select * from app_settings where sgroup in ('emergency','contacts') order by sgroup, sort;`

---

## High-priority issues

### H1 — "What's New — How to Use It" page is a month stale and partly wrong
`index.html:1697-1790` (`#howtoModal`), opened from All Sections → "What's New" card (`index.html:289`, `openHowTo` `js/08_availability.js:135`). Version stamp `HOWTO_VERSION = '2026.06.25.aaron'` (`js/08:134`); header says *"built from Aaron's feedback · **June 2026**"* (`index.html:1712`) and *"Everything below is live in the app right now."*

Claim-by-claim check against current code — **13 of 16 sections verified accurate** (Employee Profile `js/04:146`, Supply Request `js/10:672`, Crew Trainer `js/10:579`, Stay Logged In `index.html:177` + `js/02:309`, Recognition `js/07:117`, Corrective Actions `js/09:839`, Emergency, Training & Resources, Equipment History + QR `js/11:1120`, Maintenance→Equipment link `js/08:141`, Pre-Shift `index.html:1692`, Warehouse equipment, Call-a-coworker, Confirm Schedule `js/01:428`). The problems:

| # | Claim | Reality | Severity |
|---|---|---|---|
| 1 | **"Learning Paths (sample)… This is a sample to walk the flow — the wording is placeholder. Tap Reset progress to run it again."** (`index.html:1730-1732`) | Superseded. Learning Paths are now **"real, database-backed"** (`js/08_availability.js:421` comment) and on **2026-07-14 Training Hub Phase 1 shipped** (`js/22_training_hub.js`, `deploy_20260714_training_phase1.bat`) with stages, OJT, practical sign-offs and certifications. The **"Reset progress" button no longer exists anywhere in the code** (grep: zero hits in `js/`). Telling staff their training is "a sample with placeholder wording" now actively undermines the new Phase 1 program. | High |
| 2 | **"Pick n' Take Orders (via Cherry)… In Cherry (the assistant), Ask Cherry"** (`index.html:1768-1770`) | No "Ask Cherry" UI exists in the Hub (in-app assistant is **Mr. Scoopy**; grep for "Pick n" in `js/` = zero hits). Cherry is a separate external assistant, and `MASTER_CHECKLIST.md:25-28` says Cherry's Hub credentials are **stale/broken since the PIN→password change (verify)**. As written, a user cannot follow these steps anywhere in the app. | High |
| 3 | **"Managers also get a daily push each morning"** (Preventive Maintenance, `index.html:1774`) | The push function `app_pm_reminder()` exists, but the pg_cron schedule line is **commented out** in `preventive_maintenance.sql:189-190`. **[unconfirmed — DB]** whether it was ever scheduled manually: `select * from cron.job;` | Medium |
| 4 | "Stay Logged In… re-enter your **PIN**" (`index.html:1736`) | PIN-era wording; logins are migrating to passwords (see H4). | Low |
| 5 | Header "June 2026" + "Newest in this update" | Missing **everything shipped 2026-07-09 → 07-14**: Daily Store Report, Shift Leader Console, Store & Site Inspection, Monthly Ops Meeting Hub, Training Hub, Performance Write-Ups, Requests & Orders, Pay Tools, Command Center, Marketing Command Center v2, Maintenance Billing, Catering Pipeline, Fundraiser Hub, Sick Leave, Celebrations, password upgrade. The page now describes the app of three weeks ago as "newest". | High |

Also: the auto-popup was deliberately disabled (`maybeShowHowTo` returns immediately, `js/08:137`), so nothing surfaces updates to users at all now — see competitor idea #1.

### H2 — Time Clock says "Test mode — pick a test employee" on a primary Home button
`index.html:1508-1517` (`<!-- TIME CLOCK (Phase 2a, TEST) -->`, sub-header `:1513`, "Clock as (test employee):" `:1516`). Reached via the prominent one-tap **Time Clock** button on the Home tab (`index.html:263`) and Schedule tab — for every role. The clock is actually functional (real `app_clock_*` punches, `js/05:135-182`), but (a) first-time users are told it's a test, and (b) **any user can clock in/out as any employee** via the dropdown (`app_sched_employees` list, no self-restriction). Either finish it (default to self, label it live) or hide the Home button until it's real. Archive doc `Caliches_Hub_LIVE_Status_and_Demo_Map.html:76` confirms "Not yet wired to real payroll." *(Feature ownership may sit with the scheduling auditor; flagged here because it's the single most "unfinished-looking" thing a new user meets in session one.)*

### H3 — Visible placeholder strings in production
1. **Forms & Documents → Payroll & HR:** tile literally labeled **"PandaDoc Form — (needs a label / confirm link)"** in red (`index.html:2132`). The URL also looks **truncated** — `eform=30862498-ff17-4ecb-9d99-342540a3442` (last UUID group is 11 hex chars; should be 12) — so it likely 404s at PandaDoc. Known open item (`MASTER_CHECKLIST.md:23-24`) — needs Issac/Aaron to supply name + URL, or hide the tile until then. **[link unconfirmed — network blocked]**
2. **Live Dashboard (Admin):** *"Square & catering figures below are still illustrative."* (`index.html:910`) — hardcoded sample numbers presented on a real admin dashboard. Hide the illustrative tiles or label each tile "SAMPLE" until the POS feed exists (`MASTER_CHECKLIST.md:41-43`).
3. **Admin Console footer:** *"More controls are coming to this console."* (`index.html:2263`) — roadmap-speak in production UI. (Polish)

### H4 — PIN → password migration left contradictory copy at the front door
The backend migrated (bcrypt, `app_set_password` min 8 chars, `must_set_password` flow, `js/02:660-677`: "We are upgrading logins from short PINs to passwords…"), but:
- Register form still says **"Create a 4-Digit PIN"** (`index.html:192`) and `attemptRegister` (`js/02:678-700`) enforces **no minimum length** — new accounts are still created with 4-digit PINs that the app immediately asks to replace.
- Login placeholder "PIN / Password" (`index.html:176`), error "Invalid Username or **PIN**" (`js/02:629`), link "Forgot **PIN**?" (`index.html:181`), recovery modal "We'll send your **PIN** to that email" (`index.html:34-38` region).
- Settings: "Change PIN / Password" mixed label; **Privacy & Data** text still says we collect "your **PIN**" and references "**shortage reports**" (renamed Supply Request) — `index.html:124` region.
Pick one word ("password"), update the six spots, and add the 8-char minimum to registration. (Medium-High: it's every new user's first 30 seconds.)

---

## Missing / incomplete features (this scope)

| Item | Evidence | Severity |
|---|---|---|
| **"How to Use the Hub" guided tour built but shelved** — Home tile `btn-howto` is `display:none` (`index.html:276`), auto-launch disabled with comment *"still in progress — NOT released to users yet"* (`js/11:953-958`, `openAppTour` `:959` works). Nothing un-hides the tile (only the hidden-tile registry references it, `js/01:1084`). Net effect: the app has **no first-run onboarding** (falls back to the Scoopy teach nudge). | `js/11_customer_history_autosuggest.js:952-965` | Medium |
| **Emergency `police` setting dead**; "[2 hours]" literal; numbers not tap-to-call | see B1 | Medium |
| **Announcements: no expiry / no age shown.** Announcement bar (`app_announcement` id=1, `js/10:222-296`) displays whatever text is in the table indefinitely until a manager manually clears it; no posted-date shown to staff. Updates feed items likewise have no archive/hide flow. Date-bound posts ("Early close Friday…") inevitably go stale on screen. | `js/10_my_maintenance_submissions.js:222-296`, `js/09:1151-1192` | Medium |
| **Updates "Delete" is a hard delete** — "This cannot be undone" (`app_announcement_delete`, `js/09:1192`) — conflicts with the house rule that old info is hidden, never deleted. Suggest an `archived` flag + "Hide" wording instead. | `js/09_work_orders_maintenance_phase.js:1191-1192` | Medium |
| **Crew members have no notification center.** Bell + panel are manager-roles-only (`setupNotifications`, `js/11:608-629`); crew get pushes + a Messages unread dot only, with no in-app history of "what pinged me". Also the notification-prefs matrix roles (`NOTIF_ROLES`, `js/08:257`) omit **'Store Manager'**, which the rest of the app treats as a manager role — a Store Manager's per-type prefs can't be configured. **[backend default unconfirmed]** | `js/11:608-629`, `js/08:247-257` | Medium |
| **Orphaned legacy "Store Shortage Report" form** — full `#shortageView` markup + working `submitShortage()` remain (`index.html:1906-1907`, `js/10:799-811`) but no menu/tile opens it (replaced by Supply Request; tile `btn-shortage` repurposed, `js/01:928`). Dead weight; hardcoded 5-store list. Safe to delete markup or leave hidden. | `index.html:1906` | Low |
| **Time Clock self-identification** — see H2 | | High |

---

## Stale-content candidates — the master "hide/refresh this" list, section by section

*Legend: [code] = fix is in repo text · [DB] = content lives in Supabase, could not be verified from sandbox — check live · [ext] = external link, verify by clicking.*

**1. Login & account**
- [code] "Create a 4-Digit PIN", "Forgot PIN?", "PIN / Password", "Invalid Username or PIN", "Send My PIN" — PIN-era set (H4). `index.html:34-38,176,181,192`, `js/02:629`.
- [code] Settings → Privacy & Data: "PIN" + "shortage reports" wording; collection list predates schedules/evaluations/pay data. `index.html:~124` region.

**2. Home tab**
- [code] "What's New" card (`index.html:289`) opens June-25 content (H1) — the single most user-visible stale artifact.
- [code] Hidden "How to Use the Hub" tile (`:276`) — decide ship-or-remove.
- OK: My Day, Needs You Today (`js/01:395-444`), recognition feed, Jump To, weekly rotating quotes (`js/10:182-217`) — all live-wired, nothing hardcoded-stale.

**3. What's New page** — supersede/rewrite (H1). Specific rot: "Learning Paths (sample)" + "Reset progress" (gone), "Ask Cherry" Pick n' Take, "PIN" wording, PM "daily push" claim, "June 2026" header.

**4. Emergency screen** — banner `index.html:2338` (remove after B1), `[____]` × 13, "[2 hours]", [DB] Key contacts rows unknown.

**5. Messages**
- [DB] **Updates tab**: whatever announcements are in the feed — check for past-dated/event-specific posts; no archive flag exists, so anything old is still showing. Run: `select id,title,left(body,60),created_at from announcements order by created_at desc limit 20;` (table name per `app_announce_feed` — RPC not in repo SQL).
- [DB] **Announcement bar**: `select message, updated_at from app_announcement where id=1;` — if it's a June post it's been up ~a month.
- [code] Store feed / DMs: clean; "No messages yet. Say hi!" empty states are good.

**6. Time Clock** — "Test mode" strings `index.html:1513,1516` (H2).

**7. Live Dashboard** — illustrative Square/catering tiles `index.html:910` (H3.2).

**8. Forms & Documents** (`index.html:~2100-2140`)
- [code] PandaDoc placeholder tile `index.html:2132` (H3.1).
- [ext] All JotForm/PandaDoc/Dropbox/pCloud links unverifiable from sandbox — worth one manual click-through before launch; the pCloud "Hiring Paperwork Uploads" and Dropbox "Onboarding Paperwork" links are the likeliest to have expired tokens.

**9. Training**
- [code] What's New "sample" framing vs Phase 1 Training Hub (H1.1) — also check the **old sample path content in the DB** (White Apron sample lessons with placeholder wording, `MASTER_CHECKLIST.md:38-40`): if real Phase 1 paths now coexist with the June sample path, hide the sample. [DB] `select id,title from lp_paths;` equivalent.
- [code] Two entry points now exist — Training & Resources → "🎓 Learning Paths" (old LMS, `openLmsPreview`) and Admin/Team → "Training Hub" (`js/22`). Confirm intended; label them distinctly so staff don't think one is broken.

**10. Legacy forms (hardcoded store lists)** — old shortage form (orphaned), Pop-In location list (includes 'Scoopy','Poochi','Caliche's Cruiser'), Pre-Shift store list, Maintenance form stores: all hardcoded 5-store `<option>` sets that ignore Manage Stores (`QA_Release_Gating_Report_June29.md` #8 flagged the pattern). If a store is ever added/renamed these go stale silently. (Low each; one sweep to drive them all from `HUB_STORES`.)

**11. Admin Console** — "More controls are coming to this console" `index.html:2263`.

**12. Repo hygiene (not user-visible)** — `_archive/` holds outdated mirrors of the What's New page and June status docs; `Caliches_Hub_LIVE_Status_and_Demo_Map.html` is a useful honest-state snapshot but is itself now stale (predates July wave). No action needed for launch; don't ship them anywhere.

**13. Seasonal/date-bound in code** — sweep came back clean: no hardcoded 2025 dates, no seasonal promos, no month-named content in `index.html`/`js` beyond the What's New header (grep for `2025|June 2026|summer|holiday|christmas|pumpkin` = only benign hits: season pickers in Marketing, template-name example "Standard summer week"). All remaining date-bound risk lives in **DB content** (announcements, tasks, training), which is exactly where the expiry mechanism (Missing #3) is absent.

---

## Competitor-inspired ideas (Homebase / 7shifts / Beekeeper patterns → first-session polish)

1. **Split "What's New" into (a) a dated changelog and (b) an evergreen "How to Use the Hub" guide.** Best-practice release notes answer *what changed / who it's for / why it matters*, grouped by month with New/Improved labels (Appcues/AnnounceKit pattern; Notion's screenshot-first style). The Hub already has the machinery — `HOWTO_VERSION` + `localStorage` seen-flag (`js/08:134-137`) — re-enable the once-per-version popup showing **only the newest month**, with "See all updates" below. Keeps the help page honest forever because old entries age into history instead of masquerading as "newest."
2. **First-session "Get set up" checklist on Home** (7shifts-style onboarding): 4–5 items — take the 60-second tour (finish the already-built `openAppTour`), turn on push, confirm your phone number for the Call button, find your schedule, say hi in My Store. Homebase's trick of dropping new hires straight into team chat is free here: auto-open the My Store thread with a welcome post on first login. Progress ring on the card; disappears when done.
3. **Make Emergency a true crisis card (Beekeeper crisis-tool pattern):** every number rendered as a big `tel:` button (incl. a red "Call 911"), Key contacts pinned above scenarios, and an explicit "works offline" badge (the localStorage cache already exists — advertise it). Add a "last reviewed <date> by <name>" stamp on the Emergency screen so stale safety info becomes visible instead of silent.
4. **Acknowledgment-required announcements:** the Updates feed already tracks per-person reads ("✓ Read by N", `js/09:1173`). Add a "requires acknowledgment" checkbox on post + a "who hasn't seen it" list for managers — 7shifts' most-loved announcements feature, and it turns policy changes into auditable comms.
5. **Expiry-by-default for broadcast content:** optional "Show until" date on the announcement bar and Updates posts (default e.g. 14 days), after which they auto-hide (never delete — status flag), plus a posted-date chip on the bar. This one change structurally prevents the whole "past-dated content still shown as current" class of staleness.

Sources: [Homebase vs 7shifts (Connecteam review)](https://connecteam.com/homebase-vs-7shifts/) · [7shifts Employee Onboarding KB](https://kb.7shifts.com/hc/en-us/articles/5804548839699-7shifts-101-Employee-Onboarding) · [Homebase comparison page](https://www.joinhomebase.com/compare/homebase-vs-7shifts) · [Beekeeper frontline work app](https://www.beekeeper.io/platform/work-app/) · [Appcues release-notes examples](https://www.appcues.com/blog/release-notes-examples) · [AnnounceKit release-notes best practices](https://announcekit.app/guides/release-notes-best-practices) · [Userpilot release notes](https://userpilot.com/blog/release-notes/)

---

## Open questions for Issac

1. **Emergency numbers (Blocker):** who is "manager on call" per store, and what are the 5 numbers (manager-on-call, electric/gas utility, internet provider, machine vendor, water utility)? Single companywide set, or per-store? (Current schema is one companywide set; per-store would need a small additive change.) Should "Police (non-emergency)" be rendered, and where?
2. **What's New:** rewrite it now as "July 2026" (covering the 9–14 July wave + Training Hub Phase 1), or hold until the 30-day launch and ship one big "Launch edition"? Should the once-per-version popup come back?
3. **Time Clock:** is it launching for real (self-only punching, drop "Test mode") or should the Home button be hidden at launch? Which is the system of record — Hub clock or Axial?
4. **Cherry:** is the email→Pick n' Take flow still operational after the password change (`MASTER_CHECKLIST.md:25-28`)? If not, pull that What's New section; if yes, reword it (staff-facing assistant is Mr. Scoopy — "Cherry" appearing only in Fundraiser brief/Ops Meeting copy is fine for managers).
5. **PandaDoc tile:** correct label + full URL (current one appears truncated), or hide the tile?
6. **Announcement expiry:** OK to add "Show until" + posted-date to the bar and Updates (auto-hide, never delete)? And change Updates "Delete" to "Hide/Archive"?
7. **DB content review (I couldn't reach the DB from the sandbox):** please run the three queries flagged **[DB]** above (announcement bar row, recent announcements, `app_settings` emergency/contacts groups) — or grant a path and I'll do it — so we can build the definitive "hide this" list for feed content.
8. **PM daily push:** was `pm-reminder-daily` ever scheduled in pg_cron? (`select * from cron.job;`) If not, schedule it or soften the What's New claim.
