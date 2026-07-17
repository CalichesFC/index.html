# Open Questions From the Audit — answer whenever, none of these block current fix work

These are product/content decisions only you can make. I'm not waiting on them to start fixing the Blockers — they're organized here so you can answer at your own pace, in any order, whenever you have a few minutes.

## Payments
- Once Square is actually configured: keep a single lump-sum pay link, or do you want deposits/partial payments?
- Do you want Square's own official receipt captured and linked inside the Hub too, or is the Hub's own printable receipt enough for your records?

## Scheduling
- Should Store/Assistant Managers be able to add employees from the Schedule Portal, or should that stay Admin-only?
- Should punch edits/deletes require a typed reason before saving, for a clean payroll audit trail?

## Daily Ops
- Is "Store & Site Inspection" meant to eventually replace "Store Pop-In Inspection," or are both intentionally permanent, separate tools?
- Should Vehicle Check-Out's 6 safety checkboxes become required, matching Pop-In's all-51-required rigor?
- OK to hide the Manager Dashboard's "Shortages" tab and retire the old, unreachable shortage-report form underneath it?

## Maintenance
- Should editing an already-verified invoice automatically kick it back to "needs re-verification"?
- Where should a crew member go to check the status of a repair they filed through Work Orders? (Worth building a simple "my requests" tracker — right now there isn't one.)

## Team / HR
- Should managers see only their own store's evaluations and growth data, or company-wide like today?
- OK to retire the old, orphaned "Report a Concern" screen now that Your Voice fully replaces it?

## Training
- What real content can you provide for Learning Paths, and on what timeline? If it's not ready inside the 30 days, should the tile go manager-only / "coming soon" in the meantime?
- Is "Reset progress" (promised in the in-app help text) still a feature you want built, or should that line just be removed?
- Should Crew Trainer coaching notes eventually feed into certifications, or stay a fully separate system permanently?
- Should quizzes that mix auto-graded and long-answer questions also route the written portion to manager review (today only all-long-answer quizzes do)?

## Admin / Time Clock
- Is `app_admin_delete_user` (the Users tab "Delete" button) a real database delete? If so, should it be replaced with the Roster's proper deactivate-not-delete flow?

## Content
- Emergency numbers: who is "manager on call" per store, and what are the actual numbers (manager-on-call, utility, internet, machine vendor, water utility)? One company-wide set, or different per store? Should a "Police (non-emergency)" number be shown too?
- Rewrite "What's New" now to cover everything shipped through mid-July, or hold it for one big "launch edition" at the end of the 30 days?
- Is the Cherry email → "Pick n' Take" flow still working after the password migration? If not, that section should come out of the in-app help page.
- Correct label + working link for the "PandaDoc Form (needs a label)" tile — or should it just stay hidden until you have it?
- OK to add a "show until" expiry date to announcements (auto-hide, never delete) and change Updates' "Delete" to "Hide/Archive" to match your archive-don't-delete rule?

---

See `specs/AUDIT_MASTER_SUMMARY.md` for the full findings these come from.