# Deploy steps — July 13, 2026 (de-dupe + Aaron's-specs finish pass)

Three actions, in this order. Everything else is already done in the code (full-app syntax verified).

## 1. Supabase — six SQL pastes, in this order (10 min)
Open https://supabase.com/dashboard → project `ikgbihwkqhsfahnswfbz` → SQL Editor. For each file below (all in this folder): open in Notepad, copy ALL, paste, Run. All six are idempotent — safe to re-run. Expect "Success."

1. `supabase_step1_square_link_amount.sql` (tiny — Square regen guard column)
2. `marketing_command_center.sql` (the marketing backend that was never run on 7/9)
3. `team_growth_finish.sql` (TG Company dashboard, 4 reports, spine, automation, cert-sync trigger, Scoopy)
4. `dsr_opm_finish.sql` (Ops Meeting auto-fill + history; insights now include marketing/training)
5. `site_inspection_finish.sql` (auto follow-up inspections, reminders, Scoopy)
6. `training_finish.sql` (Ready-to-Start paid pre-start cert + payroll export, Quick Scoops, SCORM info, Scoopy)

## 2. Supabase — update the square-invoice Edge Function (3 min)
Dashboard → Edge Functions → `square-invoice` → edit the code → replace everything with the contents of `edge-functions\square-invoice.ts` (in this folder) → Deploy.
This fixes: the "idempotency key has already been used" 400 error, and pay links now auto-regenerate when a quote's total changes (the $620 → $350 problem).

## 3. Deploy the Hub (1 double-click)
Double-click **`deploy_20260713.bat`** in this folder. It stamps a new build, commits, and pushes. Window shows the log and pauses so you can read it.
Then tell Claude "deployed" — I'll verify the live site.

## What changed in this build (finish pass, added after the de-dupe list below)
- **Team Growth:** new corporate "Company" tab (eval compliance %, overdue reviews, pending-proposal $ exposure, promotion queue, certs expiring, recognition, concerns — company + per-store) with 4 printable reports; "Development" card showing Passport level, learning-path %, station clearances as real eligibility inputs; PIP button + Active-PIP chip right inside Team Growth; automation scan (overdue-review tasks + cert notifications); training certs now auto-sync into the employee cert store (the spine).
- **Daily Store Report:** Print / Save PDF packet, Archive PDF to Dropbox, and a manager History (audit) view on submitted reports.
- **Ops Meeting:** "↻ Auto-fill from store data" (sales, labor, prime %, transactions, avg ticket — month vs prior vs last year, manager edits before save) + History tab; insight generator now also surfaces marketing campaigns and training themes.
- **Site Inspection:** failing/critical inspections auto-create a linked follow-up inspection and notify leadership; Reminders button (due-soon/overdue scans with dedupe); before/after "Fixes" photo timeline; Print / Save PDF packet.
- **Training Hub:** Ready-to-Start paid pre-start training (assign → timed sessions → approve → cert → payroll CSV export); Quick Scoops refresher engine (create, target, track, offered automatically after a failed sign-off); SCORM package upload + launch in the path builder.

## What changed in this build (de-dupe pass)
- **Catering:** the old "Create Catering Quote" + "Sales Pipeline" menu tiles are gone; both now live INSIDE the Catering Pipeline board as "📝 Quote Builder" and "📊 Quotes & Invoices" buttons. Same proven engines (quotes, Square pay links, accept links) — one door, manager-visible.
- **Marketing:** one "Marketing Command Center" tile for everyone (planner for leadership, Store Tools for store roles, cross-linked inside). The old second tile is retired.
- **Naming:** the ops dashboard tile is now "Store Intelligence" (was "Command Center") — no more collision with Marketing Command Center.
- **Logbook:** confirmed both logbook surfaces already share ONE table; the quick Manager Logbook now says so, links to the Daily Store Report, and shows a clean "DSR" chip on report-tagged notes.
- **Square:** edge function regenerates pay links safely (fresh key per attempt + amount-change detection).

## Still open after this deploy (next passes)
- Employee-development spine wiring (Training → Passport → clearances → Team Growth)
- Team Growth corporate dashboard + reports + automation + exports
- DSR PDF/Dropbox export + audit viewer · Ops Meeting Axial auto-fill · Inspection follow-ups/PDF · Training Ready-to-Start + Quick Scoop + SCORM UI
- Your items: Square production token + webhook key (see OPEN_ITEMS_Aaron_Adri.md), Axial access for the other 4 stores, training content
