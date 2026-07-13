# Caliche's Hub — Open Items from Aaron's & Adri's Requests
_Updated 2026-07-13. Everything not listed under "Still open" is built, deployed, and verified live._

## Still open — needs you (ops config, outside the code)

- [ ] **Square production token + webhook signature key** — set `SQUARE_ACCESS_TOKEN` to your Production token, `SQUARE_ENV=production`, and create a production webhook subscription (events: `payment.updated`, `payment.created`, `invoice.payment_made`, `invoice.updated`) whose **Signature Key** goes in `SQUARE_WEBHOOK_SIGNATURE_KEY`. This makes catering invoices flip to **Paid** automatically. Until then the manual **Mark Paid** button works.
- [ ] **Connect the other stores to Axial** — only Roadrunner has data today. Valley / Lenox / Alamogordo / Roswell auto-map into the scorecards, Command Center, and prime-cost auto-fill as soon as they're granted Axial data access. No code needed.

## Resolved this pass (2026-07-13)

- [x] **Manager / shift-leader hours in labor** — confirmed from the live Axial feed that your shift-leaders and store managers already clock in under the "Runner" job (a "manager" in Aloha is void/register access, not a separate job), so their hours are **already inside the Hub's total labor and Labor %**. You do NOT need a separate Manager job in Aloha. Fixed two display/calc bugs: the Command Center no longer shows a misleading "Manager 0%" split, and SPLH now divides by real paid hours (excludes the $0 shared-register terminals).

## Done and live (build 2026.07.12.2329 and 2026.07.13)

- Aaron's four systems: Shift Leader Console, Store & Site Inspection, Monthly Ops Meeting Hub, Training Hub.
- Adri's five: pay-raise tools (Pay Tools + concern gate + printable raise sheet + adjust-approved-raise with history), employment verification / W-2, digital write-up templates, party-pack auto-task, gift-card auto-task.
- Super-app: Store Intelligence Command Center + Marketing v2 store tools.
- Labor-aware scheduling: Schedule Builder shows projected labor % per day and week with green / amber / red vs target.
- Pay-raise hooks wired into the Team Growth "Pay Proposals" screen (money cards, promo queue, concern gate, raise sheet, Promotion button).
- Mr. Scoopy taught all 8 new systems (18 Q&A, live).
