# Caliche's Hub — Open Items from Aaron's & Adri's Requests
_As of 2026-07-12. Everything not listed here is built and deployed live._

Every system Aaron and Adri requested is built, applied to the database, and pushed live:
Team Growth & Evaluations, Daily Store Report, Shift Leader Console, Store & Site Inspection,
Monthly Ops Meeting Hub, Training Hub, Marketing Command Center (v1 + v2), and all five of Adri's
items (pay-raise tools, employment verification/W-2, write-up forms, party-pack and gift-card auto-tasks).
What remains below is finishing touches + a few things that need you.

## Aaron — open items

### Needs you (config / ops — outside the code)
- [ ] **Aloha: create a "Manager" job**, set each manager's **pay rate**, and have managers **clock in** under it — so manager labor flows into Labor % automatically. Until then, Labor % is hourly-crew-only.
- [ ] **Connect the other stores to Axial** — only Roadrunner has data today. Valley / Lenox / Alamogordo / Roswell auto-map once they get Axial data access.

### Built but not fully wired (dev follow-ups I can finish)
- [ ] **Labor-aware scheduling chip** — the Command Center's labor-projection helper is live, but the "projected labor X% vs target" chip isn't dropped into the Schedule Builder yet.
- [ ] **Teach Mr. Scoopy the new features** — only the Requests/Orders rail taught him so far. The other 8 new systems (Shift Console, Site Inspection, Ops Meeting, Training Hub, Write-Ups, Command Center, Pay Tools, Marketing store tools) still need Q&A added.
- [ ] **Config-editor polish** — the new config groups (shift console, inspection, ops meeting, training, command center, marketing) are editable in Business Settings via the generic list editor; a few could use friendlier labels/drawers.

### Deferred by design (waiting on real data)
- [ ] **Team Growth hours & payroll-dollar impact** — promotion "hours" and the pay-raise dollar impact are **estimates** (manager-entered typical weekly hours) until real clock/schedule hours flow. Becomes exact automatically once hours land.

## Adri — open items

### Built but not fully wired (dev follow-up I can finish)
- [ ] **Pay-raise concern gate + raise sheet, inline** — these work today inside the standalone **Pay Tools** tile. The deeper hooks that put the concern warning right at proposal-submit and the raise-sheet button inside the Team Growth "Pay Proposals" screen aren't wired into that screen yet.

### Deferred by design
- [ ] Same hours / dollar-impact estimate note applies to Adri's pay-raise money cards.

## Cross-cutting — needs you (Square, from the catering work)
- [ ] **Square production token** — set `SQUARE_ACCESS_TOKEN` to your Production token and `SQUARE_ENV=production`.
- [ ] **Square webhook signature key** — create a production webhook subscription (events: `payment.updated`, `payment.created`, `invoice.payment_made`, `invoice.updated`) and paste its **Signature Key** into the `SQUARE_WEBHOOK_SIGNATURE_KEY` secret. This is what flips catering invoices to **Paid** automatically. Until then, use the manual **Mark Paid** button (already live).

---
### The three dev follow-ups I can knock out on your say-so
1. Wire the labor-projection chip into the Schedule Builder.
2. Wire the pay-raise concern gate + raise sheet into the Team Growth "Pay Proposals" screen.
3. Teach Mr. Scoopy all the new features.
