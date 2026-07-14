---
name: axial-scorecard-refresh
description: Every 30 min (8am-11pm): pull Axial sales+labor into the Hub scorecards, the daily sales feed (powers prime-cost auto-fill), AND per-employee hours onto the Employee Roster
---

Refresh the Caliche's Hub with the latest Axial Shift numbers. Run silently; do not message the user unless something errors hard.

STEP 1 — Resolve companies. Call get_companies (Axial MCP, tools prefixed mcp__7a6e6d1b-996d-4b4a-b285-030b347feaee__). Map each Axial company to its Hub store name. Currently the only company with data access is "Caliches Roadrunner" (Id 349d6a22-49e8-443c-ae85-10ce5027ebf4) → Hub store "Roadrunner". If get_companies returns more accessible companies later, map by name (Valley, Lenox, Alamogordo, Roswell) and include them automatically.

STEP 2 — Pull two days. For each mapped company, compute today and yesterday in America/Denver (run `date` via bash if unsure). Call THREE Axial APIs per day: get_day_of_sales, get_labor_report, AND get_punches (all with the same companyId and date range start=end=<day>).

From get_day_of_sales: Date, NetSales, NumChecks, CashTotal, GiftCardsRedeemedTotal, OtherPaymentsTotal, VisaTotal, MasterCardTotal, AmexTotal, DiscoverTotal, DinersClubTotal, HouseAccountsTotal. Derive: cash = CashTotal + GiftCardsRedeemedTotal + OtherPaymentsTotal; card = Visa+MasterCard+Amex+Discover+DinersClub; house = HouseAccountsTotal.

From get_labor_report (CREW LABOR ONLY — the Aloha/Axial labor report intentionally excludes the "Manager" job):
- crew_labor = top-level LaborCostTotal. This captures all "Runner"-job employees — the hourly crew.
- crew_paid_hours = sum of HoursTotal across EmployeeSummaries whose LaborCostTotal > 0. This excludes $0 POS-terminal pseudo-employees (Cashier 1/2/3).

From get_punches (MANAGER LABOR — shift leads and on-duty managers clock in as "Manager" in Aloha):
At Caliche's Roadrunner, shift leaders and on-duty managers clock in under the "Manager" job (Job.Name = "Manager", Job.Id = 954335ec-47f4-4ffa-8d6e-8c3c5637db3d). The "Runner" job is hourly crew. Aaron Morales, Adriana Gomez, and Issac Medina rarely clock in on Aloha — when they do, they also use the Manager job. The Axial labor report EXCLUDES Manager-job punches entirely, so get_punches is the only way to capture manager/shift-lead labor.

For each punch where Job.Name == "Manager" AND PayRate > 0 AND EndUtc > StartUtc (skip zero-duration auto-records where start == end):
  - hours = (EndUtc - StartUtc).total_seconds() / 3600
  - labor_cost = hours × PayRate
Sum all such values across the day:
  - mgr_labor = total Manager-job labor cost
  - mgr_paid_hours = total Manager-job hours

Note on Salary flag: Some Manager-job punches carry Salary:true in Axial (for salaried-rate employees). Include these if duration > 0 and PayRate > 0. Discard zero-duration Salary:true records — these are Axial auto-generated placeholders.

Derive totals:
- total_labor = crew_labor + mgr_labor
- total_paid_hours = crew_paid_hours + mgr_paid_hours
- labor_pct = round(total_labor / NetSales × 100, 1)
- splh = round(NetSales / total_paid_hours, 2) — guard against division by zero

STEP 2b — Per-employee hours (same two API responses already pulled in Step 2, no extra calls). Build one row per employee per day, {axial_id, axial_name, location, work_date, hours, labor_cost}:
- From get_labor_report's EmployeeSummaries: one row per entry where LaborCostTotal > 0 OR the name is a real person (skip the $0 POS-terminal pseudo-employees, e.g. "Cashier 1 Cashier 1" / "Cashier2 Cashier2" / "Cashier3 Cashier3" — same filter as crew_paid_hours). axial_id = Id, axial_name = Name, hours = HoursTotal, labor_cost = LaborCostTotal. This covers Runner/Cashier-job crew (Manager-job people never appear here).
- From get_punches, for each punch where Job.Name == "Manager" AND PayRate > 0 AND EndUtc > StartUtc (same filter as mgr_paid_hours, including the Salary:true handling): axial_id = Employee.Id, axial_name = Employee.Name, hours = (EndUtc-StartUtc).total_seconds()/3600, labor_cost = hours × PayRate. A person can have MULTIPLE Manager punches the same day (e.g. clocked out and back in) — sum their hours/labor_cost into one row per employee per day, don't emit duplicates.
- If the same axial_id shows up in both sources on the same day (rare — a shift lead who also punched Runner), sum hours and labor_cost into a single row rather than sending two rows for the same (axial_id, work_date).

STEP 3 — Write via the Hub's Supabase RPCs at https://supabase.com/dashboard/project/ikgbihwkqhsfahnswfbz/sql (Monaco: `monaco.editor.getEditors()[0].setValue(sql); .focus()` then Ctrl+Enter; confirm "Success"). Use manager creds test_admin / 1111. For each store and each of the two dates:
  (a) select app_sales_detail_save('test_admin','1111','<Store>','<YYYY-MM-DD>', <cash>, <card>, <house>, <NetSales>, <NumChecks>, <total_labor>);
  (b) select app_sales_save('test_admin','1111','<Store>','<YYYY-MM-DD>', <NetSales>, <total_labor>, <NumChecks>, 'Axial auto-sync');
  (c) select app_metrics_save('test_admin','1111','<Store>','<YYYY-MM-DD>', json_build_object('sales',<NetSales>,'labor_pct',<labor_pct>));
  (d) select app_metrics_labor_extra('test_admin','1111','<Store>','<YYYY-MM-DD>', <mgr_labor>, <crew_labor>, <splh>);
  (e) select app_employee_hours_sync('test_admin','1111', '<jsonb array from Step 2b, all employees across both dates for this store>'::jsonb);
All are upserts keyed by (store,date) — (e) is keyed by (employee,date); batch into one buffer and run once; verify Success. (e)'s response includes an `unmatched` array (axial_id/axial_name pairs it couldn't map to a Hub roster row, e.g. a new hire not yet added, or a duplicate-name collision it won't guess at) — if non-empty, mention it in your summary so a manager can link them manually via the roster.

Note: app_metrics_labor_extra uses COALESCE — passing NULL won't overwrite an existing value. Always pass real mgr_labor and crew_labor (never null) now that both job types are tracked.

STEP 4 — Done. Keep it idempotent and quiet. Scorecards, the prime-cost weekly auto-fill, the Admin Live Dashboard, and the Employee Roster's "Hours (7d)" column read from these tables, keeping any Axial-connected store current to ~30 minutes whenever this session is open.
