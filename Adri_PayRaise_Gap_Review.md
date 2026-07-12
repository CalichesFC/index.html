# Pay-Raise Workflow — Gap Review vs. the Team Growth doc

**What this is:** a review-before-build of the pay-proposal flow already shipped in the Team Growth & Evaluations system, measured against the pay requirements in the governing developer doc. Nothing here is built yet — this is the "show me first" step so you can approve the deltas.

## What's already live (app_tg_* + js/17)

The manager→corporate pay pipeline exists end to end:

- **Pay bands** — `app_tg_payrange_list` / `app_tg_payrange_save`: min/max pay range per role, admin-editable.
- **Proposal lifecycle** — `app_tg_proposal_create` → `_save` → `_validate` (checks the proposed rate against the role's band) → `_submit` → `_decide` (corporate approve/deny) → `_mark_payroll` (payroll handoff, marked processed by an authorized person).
- **List/among** — `app_tg_proposal_list` for the Pay Proposals tab and pending queues.
- **Normal-raise %** and **review cadences** — admin-editable config (Wave 1).

So the spine the doc asks for — performance-based, band-controlled, manager-recommends / corporate-approves / payroll-confirms — is in place.

## Gaps vs. the doc (candidates to build)

**1. Performance-concern gate.** The doc: *"If unresolved performance concern exists, pay proposal workflow should warn the manager and require explanation to continue."* Today the proposal flow doesn't cross-check the discipline/coaching records. **Build:** on create/validate, look up open write-ups or unresolved coaching notes for that employee; if any, show a warning and require a justification note before submit. (Ties in nicely with the new write-up templates.)

**2. Promotion-Ready flag.** The doc: mark an employee *Promotion Ready* for corporate review when required certifications, evaluations, and a manager recommendation are all complete. The pieces exist (passport levels, certs, evals) but there's no single "Promotion Ready" state that gates on all three. **Build:** a computed Promotion-Ready badge + a manager "recommend for promotion" action feeding the corporate queue.

**3. Effective date + raise reason tied to the evaluation.** Confirm the proposal carries an **effective date** and a **reason/justification** field linked to the evaluation score (the doc frames raises as performance-justified). **Build (if missing):** add effective-date and eval-linked justification to the proposal record and the printable sheet.

**4. Corporate dashboard money cards.** The doc's Corporate dashboard wants **Approved Raises This Month**, **Estimated Payroll Impact**, and a **Payroll Exposure Report** (pending/approved raises → estimated hourly/weekly/monthly labor impact). **Build:** the count/rollup cards now; the dollar-impact math needs hours-per-week per employee, which the doc itself defers to "if hours are available" (comes with the Homebase/Aloha or clock integration). **Recommend:** build the cards + estimated-impact using a manager-entered "typical weekly hours" field as a stopgap, clearly labeled an estimate, until real hours land.

**5. Printable/exportable raise sheet.** Not called out as built. **Build:** a one-page proposal sheet (employee, current→proposed rate, effective date, justification, approvals) for records/HR, filed to Dropbox like the other HR docs.

## Recommendation

The workflow is ~70% there. The four highest-value deltas are the **performance-concern gate (1)**, **Promotion-Ready (2)**, **effective-date/justification (3)**, and the **corporate money cards + raise sheet (4/5)**. All are additive to the existing `tg_*` tables — no rebuild, nothing thrown away. Items 1–3 are small; item 4's dollar math is the only one that leans on data we don't have yet (hours), so I'd ship it as a labeled estimate now and make it exact when clock/POS hours arrive.
