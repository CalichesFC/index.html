# Marketing Command Center — v2 Doc Gap Review
**Doc reviewed:** `Caliches_Hub_Marketing_Command_Center_Developer_Request (2).docx` (identical scope to v1 upload, byte-different only)
**Built code audited:** `marketing_command_center.sql` (11 tables, 23 mkt_* RPCs), `js/13_marketing.js` (openMarketing, 10 tabs), `js/15_choice_lists.js` (4 mkt config groups), `js/16_integrations.js` (dormant adapters)
**Verdict headline:** of the doc's 22 sections — **9 DONE, 9 PARTIAL, 3 MISSING** (plus 1 N/A). The core planner/requests/budgets/assets/content/profile spine is genuinely built; the store-manager execution loop, notifications, and threshold enforcement were the real holes. `marketing_v2.sql` + `js/27_marketing_v2.js` (this build) close them additively.

---

## Section-by-section

**1. Purpose & outcome — DONE.** One in-Hub home exists: `mkt_campaigns` planner, `mkt_dashboard`, `mkt_calendar`, `mkt_requests` intake, `mkt_budget_items` + `mkt_approvals`, `mkt_assets`, `mkt_content_posts`, `mkt_metrics`, `store_marketing_profiles`, `mkt_audit_log`.

**2. First-version scope — PARTIAL.** 8 of 10 bullets built. Missing: notification/Action Center hooks (zero `push_enqueue` calls anywhere in `marketing_command_center.sql`) and a real task-board view (`mcRenderTasks` only lists campaigns + creates tasks; it never lists tasks).

**3. Non-negotiables — DONE.** Additive/idempotent SQL, RLS deny-all, SECURITY DEFINER RPCs, role gates (`_mkt_mgr`/`_mkt_leader`), audit trail (`_mkt_log` on every write), reuse of `app_task_create`, `important_contacts` (`vendor_contact_id`), `app_settings`. One soft spot: "store managers view campaign instructions" (see 14).

**4. Location/navigation — DONE.** `openMarketing()` overlay, dashboard-first, role-gated tabs (`mcCanOpen`, `mcTabs`).

**5. Roles & permissions — PARTIAL.** `_mkt_mgr` covers Manager/Admin/VP/Store Manager/Marketing Manager/Designer; `_mkt_leader` gates budgets/approvals/audit. Not modeled: Shift Leader limited instruction access, Executive/multi-store triage (doc marks both optional). v2 build: `_mkt2_mgr` includes leads so they can see instruction packets.

**6.1 Dashboard — PARTIAL.** `mkt_dashboard` returns by_status, upcoming-30d, live_now, results_due, requests_open, budgets_pending, assets_review. Missing: tasks due this week, material deadlines approaching. → v2 `mkt2_dashboard_extras`.

**6.2 Campaign Planner — DONE.** Every doc field exists on `mkt_campaigns` (type, season/quarter/month/year, goal, success_def, audience, stores jsonb, owner, team, status, priority, all 6 dates, 3 budget figures, needed_assets, related links, results, lessons, status_history). Minor UI-only gap: `team`/`priority`/`related` not editable in `mcEdit` — cosmetic, note for the author.

**6.3 Calendar — PARTIAL.** `mkt_calendar` unions launch/creative/material/results/content dates into one list; `mcRenderCalendar` groups by month. Missing: quarter/season/year grid *views* (list covers the data), and fundraiser/community event dates aren't unioned in. Accepted as v1-adequate; not rebuilt in v2 (a grid view is pure frontend polish the author can add later).

**6.4 Task board — MISSING (view), DONE (engine reuse).** Doc explicitly says don't duplicate task logic — correctly honored (`mcSaveQuickTask`/`mkt_request_convert` call `app_task_create`). But there is NO way to *see* marketing tasks, no overdue surfacing, no checklists. → v2 `mkt2_task_board` (best-effort read of the shared task table, name configurable, title-prefix filtered, overdue highlighted) + overdue reminders in `mkt2_notify_scan`. Checklists deliberately not rebuilt (would duplicate shared-task logic — the packet acks in v2 cover the store-side checklist need).

**6.5 Request intake — DONE (backend) / PARTIAL (frontend).** `mkt_request_submit` accepts every doc field incl. audience/materials/attachments; store-scoped visibility in `mkt_request_list` is genuinely good. Gaps: the js/13 form omits materials/attachments; statuses are the shorter set (no "Needs Info"/"Completed"/"Archived" offered — column is free text so this is frontend-only); request types are hardcoded in `mcRequestNew`, not admin-editable. → v2: `mkt_request_types` app_settings group + editor in js/27 Settings.

**6.6 Budget & approvals — PARTIAL.** Workflow, separation-of-duties (`requested_by = approver` blocked), `mkt_approvals` log, campaign `budget_approved` rollup all real (`mkt_budget_save/decide/list`). **The header comment claims thresholds live in app_settings group `mkt_approval_rules` — no code ever reads it.** Any `_mkt_leader` can approve any amount. Statuses Purchased/Received/Closed/Needs Revision unreachable. → v2 `mkt2_budget_decide` (tiered limits actually read from `mkt_approval_rules`) + `mkt2_budget_stage` (lifecycle + actual-cost rollup into `mkt_campaigns.actual_spend`).

**6.7 Asset library — DONE.** Link-based assets + tags + status machine + leader-only approval (`mkt_asset_save/set_status/list`). "Do Not Use" status: backend accepts any string; js/13 just lacks the button — frontend note for the author, no rebuild.

**6.8 Results / Scorecard — PARTIAL → the second-biggest gap.** v1 stores only actual_spend/results_summary/lessons (`mkt_results_save`); `mkt_metrics_add/list` exist but have no UI. Missing the doc's structured recap (what worked / didn't, repeat next year y/n/maybe, recommended changes, manager observations, customer feedback, per-channel results) and all scorecard calculations (spend vs approved, duration, on-time launch, results-submitted). → v2 `mkt2_campaign_results` (one row per field, bulk upsert) + `mkt2_results_save/get` + `mkt2_scorecard` (computed calc block incl. on-time-launch derived from `status_history`).

**6.9 Store profiles — DONE.** `store_marketing_profiles` has every doc field; `mkt_store_profile_get/save` upsert per location. UI omits local_partners/photos/contact_ids (backend ready) — frontend note.

**7. Website inquiry connections — PARTIAL by design.** `mkt_campaigns.related` jsonb carries fundraiser/quote/request/website refs; no automated routing (doc allows: "should be designed so they *can* feed"). No v2 work needed.

**8. Hootsuite/social — DONE.** `mkt_content_posts` has platform/content_type/caption/asset/owner/approval_status/scheduled/posted/hootsuite_ref/status/notes/metrics jsonb; `mkt_content_approve` gives copy approval; `mkt_metrics.source` normalizes hootsuite/meta/aloha/email for future import; js/16 keeps the dormant adapters. Exactly what the doc asked for v1.

**9. Data model — DONE.** 10/12 conceptual tables map 1:1; `marketing_tasks` intentionally = shared engine, `marketing_vendors` intentionally = `important_contacts` (both sanctioned by the doc's "don't duplicate" rule).

**10. Status models — PARTIAL.** All four status columns are free-text + configurable, but: campaign defaults differ from the doc list (Brief vs Brief Needed, no Results Needed/Canceled-Deferred...), the `mkt_statuses` group has NO editor entry (js/15 seeds only types/channels/budget_cats/asset_cats), budget lifecycle stages unreachable (see 6.6). → v2: Settings tab edits `mkt_statuses` (+ seeds the doc's exact list as the suggested default), `mkt2_budget_stage` unlocks the rest.

**11. Notifications & Action Center — MISSING entirely → built.** Not one push in the v1 marketing SQL. → v2: trigger `mkt2_request_notify` (new request → leaders; status change → requester), trigger `mkt2_budget_notify` (pending line → approvers), `mkt2_instruction_save` push to that store's managers, ack-complete push back to leaders, and `mkt2_notify_scan` (results overdue / material deadlines / stale budgets / unconfirmed stores) runnable manually or on a schedule. All exception-wrapped, generic text only.

**12. Module integrations — PARTIAL.** Contacts (vendor_contact_id) and shared tasks wired; fundraiser/catering/announcements/training are manual-link only via `related` jsonb. Acceptable v1 per doc; no v2 work.

**13. Measurement — PARTIAL.** Manual `mkt_metrics` landing table is exactly the future-proof shape the doc wants. Scorecard calculations were missing → v2 `mkt2_scorecard.calc`.

**14. Store manager experience — the BIGGEST MISS → built.** v1 gives store managers only request-submit/track. Missing: campaigns affecting my store, store-specific instructions, confirm materials received, confirm signage installed/removed, upload local photos, post-launch feedback. → v2 tables `mkt2_store_instructions` + `mkt2_instruction_acks`, RPCs `mkt2_instruction_save/list/ack`, and the js/27 "My Store" tab (checklist + photo upload via the material-upload edge fn + feedback box).

**15. Marketing team experience — DONE** (plan/convert/track/assets/budgets/results all reachable in js/13; v2 adds instruction authoring).

**16. Leadership experience — PARTIAL.** Filters existed for status/type/store/year/q only; NO spend-by-period report anywhere. → v2 `mkt2_spend_report` (month/quarter/category/campaign-type, approved vs actual) + `mkt2_campaign_search` (adds owner, launch date range, budget_status, archived toggle).

**17. Cherry/Scoopy readiness — DONE (data), open (teaching).** Records are fully structured/queryable. Teaching Scoopy the KB rows is a ship-time task per the standing rule — not part of this file pair.

**18. Configuration — PARTIAL → closed.** Admin-editable in v1: 4 list groups only. Now also: `mkt_approval_rules` (tier1/2 max + tier1/2/3 roles), `mkt2_config` (material_warn_days, budget_stale_days, ack_keys, closeout_required, tasks_table, task_prefix, 4 notify toggles), `mkt_request_types`, `mkt_statuses` — all via app_settings, editable in the js/27 Settings tab (and surfaceable in Business Settings by the author).

**19. Implementation guidance — DONE** (reuse-first everywhere; no second store/user/contact/task model; nothing hardcoded to one store).

**20. Acceptance criteria — 9 of 13 pass on v1.** Failing before v2: store-manager instruction view + confirmations (#8), notifications (#11), leadership filter set (#10 partially), overdue warnings (#9 of test scenarios). All addressed by v2.

**21–22. Test scenarios / final instruction — N/A here** (integration/deploy items). Scenario 8 (store manager sees instructions but not budgets) works in v2: instruction RPCs never expose budget fields, and budget RPCs stay `_mkt_leader`-gated.

---

## What v2 adds (this build) — summary
- **New tables:** `mkt2_store_instructions`, `mkt2_instruction_acks`, `mkt2_campaign_results` (RLS on, no policies).
- **New RPCs (13):** `mkt2_instruction_save`, `mkt2_instruction_list`, `mkt2_instruction_ack`, `mkt2_results_save`, `mkt2_results_get`, `mkt2_scorecard`, `mkt2_budget_decide`, `mkt2_budget_stage`, `mkt2_spend_report`, `mkt2_campaign_search`, `mkt2_dashboard_extras`, `mkt2_task_board`, `mkt2_notify_scan` (+ helpers `_mkt2_cfg`, `_mkt2_cfgn`, `_mkt2_mgr`, `_mkt2_in_csv`, `_mkt2_notify_leaders`; trigger fns `mkt2_request_notify_tg`, `mkt2_budget_notify_tg`).
- **New triggers:** `mkt2_request_notify` on `mkt_requests`, `mkt2_budget_notify` on `mkt_budget_items` (notification-only, exception-wrapped — existing RPC behavior untouched).
- **Frontend:** `js/27_marketing_v2.js`, entry `openMarketingV2()`, overlay `marketingV2Modal`, tabs My Store / Instructions / Closeout / Approvals / Spend / Board / Alerts / Settings.
- **Every existing `mkt_*` object left intact.** v2 never replaces a v1 function; where behavior had to change (budget approval), a new `mkt2_` RPC sits beside the old one and only js/27 calls it.
