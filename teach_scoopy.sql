-- ============================================================================
-- TEACH MR. SCOOPY the 8 new systems (teach_scoopy.sql)  -- ADDITIVE, GUARDED
-- Standing practice: Scoopy learns every shipped feature. Idempotent - only
-- inserts a Q&A when that exact question is not already in knowledge_base.
-- Category 'App Help' matches the existing Scoopy seeds.
-- ============================================================================
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('How do I run a shift with the Shift Console?',
   'Open the Shift Console tile and start (open) your shift. It gives the shift leader one live screen for the whole shift - opening and closing steps, who is on, handoff notes, and any issues to pass along. Close the shift when you leave so the next leader gets a clean handoff.'),
  ('What is Active Shift Mode?',
   'Active Shift Mode is the Shift Console running for an open shift. While a shift is open it tracks the shift leader''s checklist and lets you log handoff notes and issues in real time; the record is saved when you close the shift.'),
  ('How do I do a store or site inspection?',
   'Open the Site Inspection tile, pick the store and the inspection type, and walk the checklist scoring each item. Add notes (and photos where supported). When you submit, the score is saved and failed items can become follow-up tasks.'),
  ('Where do inspection results go?',
   'Every completed inspection is saved with its score and date, so leadership can see how a store is trending over time, and any failed item can be turned into a maintenance ticket or a task.'),
  ('What is the Monthly Ops Meeting Hub?',
   'Open the Ops Meeting tile to run your monthly operations meeting - build the agenda, record attendance, capture notes and decisions, and assign action items with owners and due dates so nothing falls through after the meeting.'),
  ('How do I track action items from the ops meeting?',
   'Action items you create in the Ops Meeting Hub carry an owner and a due date and stay attached to the meeting record, so you can review what is still open at the next meeting.'),
  ('What can I do in the Training Hub?',
   'Open the Training Hub tile to follow learning paths, take courses, and earn certifications. Managers can assign paths and sign off when someone finishes a step; your progress and certifications are saved to your profile.'),
  ('How do certifications work in the Training Hub?',
   'Finishing the required steps in a learning path earns a certification that is recorded on the employee''s profile. Managers can see who is certified and what is still in progress.'),
  ('How do I write someone up using the digital write-up forms?',
   'Open the disciplinary write-up and pick the template that fits - the role-based forms (or the General form). The template pre-fills the standard sections; you fill in the specifics and submit. It is saved with the rest of that employee''s discipline history.'),
  ('Are the new write-up templates separate from our existing discipline records?',
   'No - they are integrated. The templates are just pre-formatted versions of a write-up, and everything is stored together in the same discipline history, so there is one place to look.'),
  ('What is the Store Command Center?',
   'Open the Command Center tile for a single store-intelligence screen - sales, labor, open tasks and alerts pulled together per store, so a manager or leader can see how a store is doing at a glance.'),
  ('Does the Command Center help with scheduling?',
   'Yes. It shares its labor target with the Schedule Builder, which shows projected labor percent for each day and for the week as you build the schedule - green when you are on target, amber when you are getting close, red when you are over.'),
  ('What are Pay Tools?',
   'Open the Pay Tools tile for the money side of raises - payroll-exposure money cards, the promotion queue, and pay-proposal review. It is where leadership sees the dollar impact of proposed raises before deciding.'),
  ('What happens if I propose a raise for someone with an open performance concern?',
   'The pay proposal flags it. If there is an open disciplinary concern, the form asks for a justification before you can submit, so the concern is acknowledged rather than missed. The raise still requires a human corporate decision - raises are never automatic.'),
  ('Can a pay raise be changed after it is approved?',
   'Yes. In Pay Tools you can adjust an approved raise - amend the rate or effective date, reverse it, or supersede it - and the change is kept in the raise''s history. Remember to also key the new rate into Aloha, which is the payroll source of truth.'),
  ('Can I print a raise sheet for a pay proposal?',
   'Yes - open the pay proposal and use the raise sheet button to get a clean printable summary of the raise for signatures or the employee file.'),
  ('How do store managers get marketing instructions?',
   'Open the Marketing tile. Corporate can post store-level marketing instructions, and managers acknowledge them, so there is a record that each store saw and actioned the campaign.'),
  ('Where do I record how a marketing campaign performed?',
   'In the Marketing tile you can log campaign results per store, so corporate can see which promotions actually moved sales.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);
