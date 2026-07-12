-- ============================================================================
-- WRITE-UP TEMPLATES  (writeup_templates.sql)  -- ADDITIVE ONLY
-- Pairs with js/23_writeup_templates.js (entry openWriteupTemplates()).
--
-- WHAT THIS IS: 4 role-specific disciplinary write-up templates (Pink & Blue
-- Apron = crew, Crew Trainer, Shift Leader, Management), each with its own
-- checkbox reason set taken VERBATIM from the 4 uploaded Write Up Form docs.
-- The existing generic discipline flow (js/06, app_discipline_create_v2) stays
-- untouched and remains available as the "General" template.
--
-- NO NEW TABLES. Everything here is:
--   1) app_settings seed rows (all reason lists / coaching lists / wording are
--      admin-editable through the existing app_settings_set + js/15 choice-list
--      editor -- "everything adjustable by admins").
--      Groups: disc_tmpl_crew, disc_tmpl_crew_coach,
--              disc_tmpl_trainer, disc_tmpl_trainer_coach,
--              disc_tmpl_shiftlead, disc_tmpl_shiftlead_coach,
--              disc_tmpl_mgmt, disc_tmpl_mgmt_coach, disc_tmpl_config.
--      Row shape: label = the checkbox text (what js/15 edits/renames),
--                 svalue = section header (Management form only, else '').
--      Seeds use ON CONFLICT (skey) DO NOTHING so re-applying never clobbers
--      admin edits (app_settings.skey is the primary key).
--   2) ONE read-only RPC, app_disc_tmpl_get, that returns all four templates
--      in a single round-trip (js/14 CFG_GROUPS does not include these groups,
--      and js/14 must not be touched, so the module fetches its own config).
--
-- SAVES REUSE THE EXISTING app_discipline_create_v2 UNCHANGED (it already
-- carries p_form_type + p_form_data jsonb; the template tag rides inside
-- p_form_data.template with p_form_type='writeup', a value js/06 already
-- sends). Existing callers are unaffected.
--
-- GET SHAPE (must match js/23 -- see the shape comment there):
--   app_disc_tmpl_get returns ONE jsonb whose TOP-LEVEL key is 'templates':
--   { "templates":[ { "key","label","title","intro","coach_intro","expect",
--                     "ack","signer",
--                     "reasons":[{"label","section","sort"}],
--                     "coaching":[{"label","sort"}] } ] }
-- ============================================================================

-- ---------------------------------------------------------------------------
-- SEED: reason + coaching checkbox lists (verbatim from the 4 form docs)
-- ---------------------------------------------------------------------------
insert into public.app_settings (skey, sgroup, label, svalue, sort, updated_by)
select v.skey, v.sgroup, v.label, v.svalue, v.sort, 'writeup_templates.sql seed'
from (values
  ('disc_tmpl_crew__not_following_assigned_duties_or_task_list', 'disc_tmpl_crew', 'Not following assigned duties or task list', '', 10),
  ('disc_tmpl_crew__excessive_or_uncommunicated_breaks', 'disc_tmpl_crew', 'Excessive or uncommunicated breaks', '', 20),
  ('disc_tmpl_crew__repeated_delays_in_making_customer_orders', 'disc_tmpl_crew', 'Repeated delays in making customer orders', '', 30),
  ('disc_tmpl_crew__neglecting_food_safety_protocols', 'disc_tmpl_crew', 'Neglecting food safety protocols', '', 40),
  ('disc_tmpl_crew__not_supporting_team_during_rushes_or_downtime', 'disc_tmpl_crew', 'Not supporting team during rushes or downtime', '', 50),
  ('disc_tmpl_crew__frequent_call_ins_absences_or_tardies', 'disc_tmpl_crew', 'Frequent call-ins, absences, or tardies', '', 60),
  ('disc_tmpl_crew__lack_of_urgency_in_task_completion_item_making', 'disc_tmpl_crew', 'Lack of urgency in task completion, item-making', '', 70),
  ('disc_tmpl_crew__clocking_in_before_being_ready_to_work', 'disc_tmpl_crew', 'Clocking in before being ready to work', '', 80),
  ('disc_tmpl_crew__lack_of_initiative_and_or_awareness', 'disc_tmpl_crew', 'Lack of initiative and/or awareness', '', 90),
  ('disc_tmpl_crew__resistant_to_feedback_or_redirection', 'disc_tmpl_crew', 'Resistant to feedback or redirection', '', 100),
  ('disc_tmpl_crew__lack_of_item_knowledge_incomplete_incorrect_or', 'disc_tmpl_crew', 'Lack of item knowledge, incomplete/incorrect orders', '', 110),
  ('disc_tmpl_crew__ignoring_or_failing_to_follow_supervisor_instr', 'disc_tmpl_crew', 'Ignoring or failing to follow supervisor instructions', '', 120),
  ('disc_tmpl_crew__failure_to_communicate_when_leaving_assigned_a', 'disc_tmpl_crew', 'Failure to communicate when leaving assigned area', '', 130),
  ('disc_tmpl_crew__incomplete_or_missed_cleaning_duties', 'disc_tmpl_crew', 'Incomplete or missed cleaning duties', '', 140),
  ('disc_tmpl_crew__engaging_in_excessive_and_distractive_conversa', 'disc_tmpl_crew', 'Engaging in excessive and distractive conversation', '', 150),
  ('disc_tmpl_crew__not_following_safety_security_protocols', 'disc_tmpl_crew', 'Not following safety/security protocols', '', 160),
  ('disc_tmpl_crew__dirty_workstation_leaving_messes_behind', 'disc_tmpl_crew', 'Dirty workstation/leaving messes behind', '', 170),
  ('disc_tmpl_crew__unprofessional_or_disengaged_body_language', 'disc_tmpl_crew', 'Unprofessional or disengaged body language', '', 180),
  ('disc_tmpl_crew__failure_to_acknowledge_customers_leadership_co', 'disc_tmpl_crew', 'Failure to acknowledge customers, leadership, coworkers', '', 190),
  ('disc_tmpl_crew__carelessness_in_job_responsibilities_and_role', 'disc_tmpl_crew', 'Carelessness in job responsibilities and role', '', 200),
  ('disc_tmpl_crew__poor_attitude_towards_customers_coworkers_or_l', 'disc_tmpl_crew', 'Poor attitude towards customers, coworkers or leadership', '', 210),
  ('disc_tmpl_crew__other', 'disc_tmpl_crew', 'Other', '', 220),
  ('disc_tmpl_crew_coach__verbal_reminder', 'disc_tmpl_crew_coach', 'Verbal reminder', '', 10),
  ('disc_tmpl_crew_coach__on_the_spot_coaching_and_clarification', 'disc_tmpl_crew_coach', 'On-the-spot coaching and clarification', '', 20),
  ('disc_tmpl_crew_coach__reassignment_or_redirection', 'disc_tmpl_crew_coach', 'Reassignment or redirection', '', 30),
  ('disc_tmpl_trainer__not_effectively_training_assigned_team_members', 'disc_tmpl_trainer', 'Not effectively training assigned team members', '', 10),
  ('disc_tmpl_trainer__providing_incomplete_inaccurate_or_inconsisten', 'disc_tmpl_trainer', 'Providing incomplete, inaccurate, or inconsistent training', '', 20),
  ('disc_tmpl_trainer__failure_to_follow_model_or_teach_company_proce', 'disc_tmpl_trainer', 'Failure to follow, model, or teach company procedures and standards correctly', '', 30),
  ('disc_tmpl_trainer__lack_of_patience_professionalism_or_engagement', 'disc_tmpl_trainer', 'Lack of patience, professionalism, or engagement while training', '', 40),
  ('disc_tmpl_trainer__not_serving_as_a_positive_role_model_for_new_t', 'disc_tmpl_trainer', 'Not serving as a positive role model for new team members', '', 50),
  ('disc_tmpl_trainer__failure_to_communicate_trainee_progress_concer', 'disc_tmpl_trainer', 'Failure to communicate trainee progress, concerns, or development needs to leadership', '', 60),
  ('disc_tmpl_trainer__failure_to_provide_coaching_guidance_or_constr', 'disc_tmpl_trainer', 'Failure to provide coaching, guidance, or constructive feedback to trainees', '', 70),
  ('disc_tmpl_trainer__not_reinforcing_company_expectations_policies', 'disc_tmpl_trainer', 'Not reinforcing company expectations, policies, or procedures', '', 80),
  ('disc_tmpl_trainer__failure_to_ensure_trainees_are_practicing_prop', 'disc_tmpl_trainer', 'Failure to ensure trainees are practicing proper food safety and operational standards', '', 90),
  ('disc_tmpl_trainer__inadequate_product_knowledge_or_inability_to_a', 'disc_tmpl_trainer', 'Inadequate product knowledge or inability to answer trainee questions appropriately', '', 100),
  ('disc_tmpl_trainer__unprofessional_tone_attitude_or_conduct_in_a_t', 'disc_tmpl_trainer', 'Unprofessional tone, attitude, or conduct in a trainer role', '', 110),
  ('disc_tmpl_trainer__resistance_to_feedback_or_redirection_regardin', 'disc_tmpl_trainer', 'Resistance to feedback or redirection regarding training responsibilities', '', 120),
  ('disc_tmpl_trainer__failure_to_demonstrate_expected_standards_of_q', 'disc_tmpl_trainer', 'Failure to demonstrate expected standards of quality, cleanliness, friendliness, speed, or accuracy', '', 130),
  ('disc_tmpl_trainer__attendance_or_reliability_issues_impacting_tra', 'disc_tmpl_trainer', 'Attendance or reliability issues impacting training responsibilities', '', 140),
  ('disc_tmpl_trainer__other', 'disc_tmpl_trainer', 'Other', '', 150),
  ('disc_tmpl_trainer_coach__verbal_reminder', 'disc_tmpl_trainer_coach', 'Verbal reminder', '', 10),
  ('disc_tmpl_trainer_coach__on_the_spot_coaching_and_clarification', 'disc_tmpl_trainer_coach', 'On-the-spot coaching and clarification', '', 20),
  ('disc_tmpl_trainer_coach__training_observation_feedback', 'disc_tmpl_trainer_coach', 'Training observation & feedback', '', 30),
  ('disc_tmpl_trainer_coach__development_coaching_conversation', 'disc_tmpl_trainer_coach', 'Development coaching conversation', '', 40),
  ('disc_tmpl_shiftlead__not_effectively_leading_or_directing_the_shift', 'disc_tmpl_shiftlead', 'Not effectively leading or directing the shift', '', 10),
  ('disc_tmpl_shiftlead__lack_of_urgency_or_leadership_presence_during', 'disc_tmpl_shiftlead', 'Lack of urgency or leadership presence during rushes or peak business', '', 20),
  ('disc_tmpl_shiftlead__poor_judgment_or_decision_making_impacting_ser', 'disc_tmpl_shiftlead', 'Poor judgment or decision-making impacting service or operations', '', 30),
  ('disc_tmpl_shiftlead__failure_to_hold_team_members_accountable_to_ex', 'disc_tmpl_shiftlead', 'Failure to hold team members accountable to expectations', '', 40),
  ('disc_tmpl_shiftlead__inadequate_communication_with_team_members_or', 'disc_tmpl_shiftlead', 'Inadequate communication with team members or leadership', '', 50),
  ('disc_tmpl_shiftlead__failure_to_follow_model_or_enforce_company_pol', 'disc_tmpl_shiftlead', 'Failure to follow, model, or enforce company policies and procedures', '', 60),
  ('disc_tmpl_shiftlead__inconsistent_or_incorrect_execution_of_operati', 'disc_tmpl_shiftlead', 'Inconsistent or incorrect execution of operational standards', '', 70),
  ('disc_tmpl_shiftlead__not_supporting_coaching_or_guiding_team_member', 'disc_tmpl_shiftlead', 'Not supporting, coaching, or guiding team members appropriately', '', 80),
  ('disc_tmpl_shiftlead__poor_shift_organization_task_delegation_or_tim', 'disc_tmpl_shiftlead', 'Poor shift organization, task delegation, or time management', '', 90),
  ('disc_tmpl_shiftlead__failure_to_prioritize_customer_experience', 'disc_tmpl_shiftlead', 'Failure to prioritize customer experience', '', 100),
  ('disc_tmpl_shiftlead__resistance_to_feedback_or_redirection', 'disc_tmpl_shiftlead', 'Resistance to feedback or redirection', '', 110),
  ('disc_tmpl_shiftlead__unprofessional_tone_attitude_or_conduct_in_a_l', 'disc_tmpl_shiftlead', 'Unprofessional tone, attitude, or conduct in a leadership role', '', 120),
  ('disc_tmpl_shiftlead__failure_to_escalate_concerns_appropriately_or', 'disc_tmpl_shiftlead', 'Failure to escalate concerns appropriately or timely', '', 130),
  ('disc_tmpl_shiftlead__attendance_or_reliability_issues_impacting_lea', 'disc_tmpl_shiftlead', 'Attendance or reliability issues impacting leadership coverage', '', 140),
  ('disc_tmpl_shiftlead__other', 'disc_tmpl_shiftlead', 'Other', '', 150),
  ('disc_tmpl_shiftlead_coach__verbal_reminder', 'disc_tmpl_shiftlead_coach', 'Verbal reminder', '', 10),
  ('disc_tmpl_shiftlead_coach__on_the_spot_coaching_and_clarification', 'disc_tmpl_shiftlead_coach', 'On-the-spot coaching and clarification', '', 20),
  ('disc_tmpl_shiftlead_coach__post_shift_feedback_discussion', 'disc_tmpl_shiftlead_coach', 'Post-shift feedback discussion', '', 30),
  ('disc_tmpl_shiftlead_coach__leadership_coaching_conversation', 'disc_tmpl_shiftlead_coach', 'Leadership coaching conversation', '', 40),
  ('disc_tmpl_mgmt__failure_to_hold_team_members_accountable_to_co', 'disc_tmpl_mgmt', 'Failure to hold team members accountable to company standards and expectations', 'Leadership & Accountability', 10),
  ('disc_tmpl_mgmt__failure_to_effectively_coach_develop_or_suppor', 'disc_tmpl_mgmt', 'Failure to effectively coach, develop, or support team members', 'Leadership & Accountability', 20),
  ('disc_tmpl_mgmt__failure_to_address_performance_concerns_policy', 'disc_tmpl_mgmt', 'Failure to address performance concerns, policy violations, or behavioral issues appropriately', 'Leadership & Accountability', 30),
  ('disc_tmpl_mgmt__failure_to_create_and_maintain_a_positive_prof', 'disc_tmpl_mgmt', 'Failure to create and maintain a positive, professional, and accountable team culture', 'Leadership & Accountability', 40),
  ('disc_tmpl_mgmt__lack_of_leadership_presence_urgency_or_engagem', 'disc_tmpl_mgmt', 'Lack of leadership presence, urgency, or engagement within the store', 'Leadership & Accountability', 50),
  ('disc_tmpl_mgmt__failure_to_lead_by_example_through_attitude_pr', 'disc_tmpl_mgmt', 'Failure to lead by example through attitude, professionalism, work ethic, or conduct', 'Leadership & Accountability', 60),
  ('disc_tmpl_mgmt__poor_communication_with_team_members_peers_or', 'disc_tmpl_mgmt', 'Poor communication with team members, peers, or supervisors', 'Leadership & Accountability', 70),
  ('disc_tmpl_mgmt__failure_to_maintain_quality_cleanliness_friend', 'disc_tmpl_mgmt', 'Failure to maintain quality, cleanliness, friendliness, speed, or accuracy standards', 'Operations & Standards', 80),
  ('disc_tmpl_mgmt__failure_to_follow_model_or_enforce_company_pol', 'disc_tmpl_mgmt', 'Failure to follow, model, or enforce company policies and procedures', 'Operations & Standards', 90),
  ('disc_tmpl_mgmt__inconsistent_execution_of_operational_standard', 'disc_tmpl_mgmt', 'Inconsistent execution of operational standards and expectations', 'Operations & Standards', 100),
  ('disc_tmpl_mgmt__failure_to_ensure_food_safety_sanitation_or_se', 'disc_tmpl_mgmt', 'Failure to ensure food safety, sanitation, or security standards are being followed', 'Operations & Standards', 110),
  ('disc_tmpl_mgmt__failure_to_maintain_an_organized_prepared_and', 'disc_tmpl_mgmt', 'Failure to maintain an organized, prepared, and operationally sound store environment', 'Operations & Standards', 120),
  ('disc_tmpl_mgmt__failure_to_appropriately_staff_schedule_and_ma', 'disc_tmpl_mgmt', 'Failure to appropriately staff, schedule, and manage labor in accordance with business needs and company expectations', 'Staffing, Scheduling & Time Management', 130),
  ('disc_tmpl_mgmt__failure_to_monitor_attendance_tardiness_or_tea', 'disc_tmpl_mgmt', 'Failure to monitor attendance, tardiness, or team accountability', 'Staffing, Scheduling & Time Management', 140),
  ('disc_tmpl_mgmt__failure_to_properly_train_develop_or_onboard_t', 'disc_tmpl_mgmt', 'Failure to properly train, develop, or onboard team members', 'Staffing, Scheduling & Time Management', 150),
  ('disc_tmpl_mgmt__failure_to_follow_the_required_management_sche', 'disc_tmpl_mgmt', 'Failure to follow the required management schedule expectations', 'Staffing, Scheduling & Time Management', 160),
  ('disc_tmpl_mgmt__failure_to_maintain_expected_availability_or_l', 'disc_tmpl_mgmt', 'Failure to maintain expected availability or leadership coverage', 'Staffing, Scheduling & Time Management', 170),
  ('disc_tmpl_mgmt__mismanagement_of_labor_scheduling_or_personal', 'disc_tmpl_mgmt', 'Mismanagement of labor, scheduling, or personal hours resulting in unnecessary overtime, labor inefficiencies, or inadequate store coverage', 'Staffing, Scheduling & Time Management', 180),
  ('disc_tmpl_mgmt__failure_to_utilize_scheduled_time_effectively', 'disc_tmpl_mgmt', 'Failure to utilize scheduled time effectively and productively', 'Staffing, Scheduling & Time Management', 190),
  ('disc_tmpl_mgmt__failure_to_appropriately_prioritize_administra', 'disc_tmpl_mgmt', 'Failure to appropriately prioritize administrative, operational, or leadership responsibilities', 'Staffing, Scheduling & Time Management', 200),
  ('disc_tmpl_mgmt__failure_to_complete_assigned_administrative_du', 'disc_tmpl_mgmt', 'Failure to complete assigned administrative duties accurately or on time', 'Communication & Administrative Responsibilities', 210),
  ('disc_tmpl_mgmt__failure_to_communicate_important_information_t', 'disc_tmpl_mgmt', 'Failure to communicate important information to leadership or team members', 'Communication & Administrative Responsibilities', 220),
  ('disc_tmpl_mgmt__failure_to_follow_up_on_assigned_projects_task', 'disc_tmpl_mgmt', 'Failure to follow up on assigned projects, tasks, or action items', 'Communication & Administrative Responsibilities', 230),
  ('disc_tmpl_mgmt__failure_to_respond_to_communications_in_a_time', 'disc_tmpl_mgmt', 'Failure to respond to communications in a timely manner', 'Communication & Administrative Responsibilities', 240),
  ('disc_tmpl_mgmt__poor_decision_making_impacting_store_operation', 'disc_tmpl_mgmt', 'Poor decision-making impacting store operations, customer or team experience', 'Business Performance', 250),
  ('disc_tmpl_mgmt__failure_to_appropriately_manage_labor_food_cos', 'disc_tmpl_mgmt', 'Failure to appropriately manage labor, food cost, inventory, or controllable expenses', 'Business Performance', 260),
  ('disc_tmpl_mgmt__failure_to_execute_company_initiatives_promoti', 'disc_tmpl_mgmt', 'Failure to execute company initiatives, promotions, or directives', 'Business Performance', 270),
  ('disc_tmpl_mgmt__failure_to_take_ownership_of_store_performance', 'disc_tmpl_mgmt', 'Failure to take ownership of store performance and results', 'Business Performance', 280),
  ('disc_tmpl_mgmt__resistance_to_feedback_coaching_or_direction', 'disc_tmpl_mgmt', 'Resistance to feedback, coaching, or direction', 'Professionalism', 290),
  ('disc_tmpl_mgmt__unprofessional_conduct_attitude_or_communicati', 'disc_tmpl_mgmt', 'Unprofessional conduct, attitude, or communication', 'Professionalism', 300),
  ('disc_tmpl_mgmt__attendance_punctuality_or_reliability_concerns', 'disc_tmpl_mgmt', 'Attendance, punctuality, or reliability concerns impacting leadership responsibilities', 'Professionalism', 310),
  ('disc_tmpl_mgmt__other', 'disc_tmpl_mgmt', 'Other', 'Professionalism', 320),
  ('disc_tmpl_mgmt_coach__verbal_reminder', 'disc_tmpl_mgmt_coach', 'Verbal reminder', '', 10),
  ('disc_tmpl_mgmt_coach__performance_coaching_conversation', 'disc_tmpl_mgmt_coach', 'Performance coaching conversation', '', 20),
  ('disc_tmpl_mgmt_coach__corrective_action_meeting', 'disc_tmpl_mgmt_coach', 'Corrective action meeting', '', 30),
  ('disc_tmpl_mgmt_coach__leadership_development_discussion', 'disc_tmpl_mgmt_coach', 'Leadership development discussion', '', 40)
) as v(skey, sgroup, label, svalue, sort)
on conflict (skey) do nothing;

-- ---------------------------------------------------------------------------
-- SEED: per-template wording / labels (group disc_tmpl_config; svalue = text)
-- ---------------------------------------------------------------------------
insert into public.app_settings (skey, sgroup, label, svalue, sort, updated_by)
select v.skey, v.sgroup, v.label, v.svalue, v.sort, 'writeup_templates.sql seed'
from (values
  ('disc_tmpl_config__label_crew', 'disc_tmpl_config', 'Template name (Pink & Blue Apron)', 'Pink & Blue Apron', 0),
  ('disc_tmpl_config__title_crew', 'disc_tmpl_config', 'Form title (Pink & Blue Apron)', 'Employee Performance Write-Up Form (Underperformance)', 10),
  ('disc_tmpl_config__intro_crew', 'disc_tmpl_config', 'Intro line above the checkboxes (Pink & Blue Apron)', 'On the date listed above, the employee was observed underperforming in the following area(s):', 20),
  ('disc_tmpl_config__coach_intro_crew', 'disc_tmpl_config', 'Intro line above the coaching checkboxes (Pink & Blue Apron)', 'This issue was addressed during the shift by the supervisor through:', 30),
  ('disc_tmpl_config__expect_crew', 'disc_tmpl_config', 'Expectations statement (Pink & Blue Apron)', 'The expectations for performance were clearly communicated, and the employee was informed that continued underperformance may result in further corrective action, up to and including termination if uncorrected.', 40),
  ('disc_tmpl_config__ack_crew', 'disc_tmpl_config', 'Acknowledgment text shown above the signatures (Pink & Blue Apron)', 'By signing below, you acknowledge that this performance issue has been reviewed with you. This form is not a guarantee of termination or discipline but serves as documentation of expectations being communicated.', 50),
  ('disc_tmpl_config__signer_crew', 'disc_tmpl_config', 'Signature line role name (Pink & Blue Apron)', 'Employee', 60),
  ('disc_tmpl_config__label_trainer', 'disc_tmpl_config', 'Template name (Crew Trainer)', 'Crew Trainer', 100),
  ('disc_tmpl_config__title_trainer', 'disc_tmpl_config', 'Form title (Crew Trainer)', 'Crew Trainer Performance Write-Up Form (Underperformance)', 110),
  ('disc_tmpl_config__intro_trainer', 'disc_tmpl_config', 'Intro line above the checkboxes (Crew Trainer)', 'On the date(s) listed above, the crew trainer was observed underperforming in the following leadership area(s):', 120),
  ('disc_tmpl_config__coach_intro_trainer', 'disc_tmpl_config', 'Intro line above the coaching checkboxes (Crew Trainer)', 'This issue was addressed during or following the shift through:', 130),
  ('disc_tmpl_config__expect_trainer', 'disc_tmpl_config', 'Expectations statement (Crew Trainer)', 'The expectations for Crew Trainer performance were clearly communicated, and the Crew Trainer was informed that continued underperformance may result in further corrective action, up to and including termination if uncorrected.', 140),
  ('disc_tmpl_config__ack_trainer', 'disc_tmpl_config', 'Acknowledgment text shown above the signatures (Crew Trainer)', 'By signing below, you acknowledge that this performance issue has been reviewed with you. This form is not a guarantee of termination or continued employment, but serves as documentation of expectations being communicated.', 150),
  ('disc_tmpl_config__signer_trainer', 'disc_tmpl_config', 'Signature line role name (Crew Trainer)', 'Crew Trainer', 160),
  ('disc_tmpl_config__label_shiftlead', 'disc_tmpl_config', 'Template name (Shift Leader)', 'Shift Leader', 200),
  ('disc_tmpl_config__title_shiftlead', 'disc_tmpl_config', 'Form title (Shift Leader)', 'Shift Leader Performance Write-Up Form (Underperformance)', 210),
  ('disc_tmpl_config__intro_shiftlead', 'disc_tmpl_config', 'Intro line above the checkboxes (Shift Leader)', 'On the date(s) listed above, the shift leader was observed underperforming in the following leadership area(s):', 220),
  ('disc_tmpl_config__coach_intro_shiftlead', 'disc_tmpl_config', 'Intro line above the coaching checkboxes (Shift Leader)', 'This issue was addressed during or following the shift through:', 230),
  ('disc_tmpl_config__expect_shiftlead', 'disc_tmpl_config', 'Expectations statement (Shift Leader)', 'The expectations for leadership performance were clearly communicated, and the shift leader was informed that continued underperformance may result in further corrective action, up to and including termination if uncorrected.', 240),
  ('disc_tmpl_config__ack_shiftlead', 'disc_tmpl_config', 'Acknowledgment text shown above the signatures (Shift Leader)', 'By signing below, you acknowledge that this performance issue has been reviewed with you. This form is not a guarantee of termination or continued employment, but serves as documentation of leadership expectations being communicated.', 250),
  ('disc_tmpl_config__signer_shiftlead', 'disc_tmpl_config', 'Signature line role name (Shift Leader)', 'Shift Leader', 260),
  ('disc_tmpl_config__label_mgmt', 'disc_tmpl_config', 'Template name (Management)', 'Management', 300),
  ('disc_tmpl_config__title_mgmt', 'disc_tmpl_config', 'Form title (Management)', 'Management Performance Write-Up Form (Underperformance)', 310),
  ('disc_tmpl_config__intro_mgmt', 'disc_tmpl_config', 'Intro line above the checkboxes (Management)', 'On the date(s) listed above, the manager was observed underperforming in the following leadership and management area(s):', 320),
  ('disc_tmpl_config__coach_intro_mgmt', 'disc_tmpl_config', 'Intro line above the coaching checkboxes (Management)', 'This issue was addressed through:', 330),
  ('disc_tmpl_config__expect_mgmt', 'disc_tmpl_config', 'Expectations statement (Management)', 'The expectations for management performance were clearly communicated, and the manager was informed that continued underperformance may result in further corrective action, up to and including termination if uncorrected.', 340),
  ('disc_tmpl_config__ack_mgmt', 'disc_tmpl_config', 'Acknowledgment text shown above the signatures (Management)', 'By signing below, you acknowledge that this performance issue has been reviewed with you. This form is not a guarantee of termination or continued employment but serves as documentation that expectations have been communicated.', 350),
  ('disc_tmpl_config__signer_mgmt', 'disc_tmpl_config', 'Signature line role name (Management)', 'Manager', 360)
) as v(skey, sgroup, label, svalue, sort)
on conflict (skey) do nothing;

-- ---------------------------------------------------------------------------
-- RPC: app_disc_tmpl_get -- one-call template read for js/23.
-- Lead gate (manager|admin|lead|owner|VP): shift leaders can open the form
-- picker, matching the existing openDiscipline() isMgmt() gate in js/06.
-- ---------------------------------------------------------------------------
create or replace function public.app_disc_tmpl_get(p_username text, p_password text)
returns jsonb
language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid  bigint;
  v_role text;
  v_name text;
  v_out  jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object('templates', coalesce(jsonb_agg(
    jsonb_build_object(
      'key',   tk.k,
      'label', coalesce((select s.svalue from public.app_settings s where s.skey = 'disc_tmpl_config__label_'  || tk.k), initcap(tk.k)),
      'title', coalesce((select s.svalue from public.app_settings s where s.skey = 'disc_tmpl_config__title_'  || tk.k), 'Performance Write-Up Form'),
      'intro', coalesce((select s.svalue from public.app_settings s where s.skey = 'disc_tmpl_config__intro_'  || tk.k), ''),
      'coach_intro', coalesce((select s.svalue from public.app_settings s where s.skey = 'disc_tmpl_config__coach_intro_' || tk.k), ''),
      'expect', coalesce((select s.svalue from public.app_settings s where s.skey = 'disc_tmpl_config__expect_' || tk.k), ''),
      'ack',    coalesce((select s.svalue from public.app_settings s where s.skey = 'disc_tmpl_config__ack_'    || tk.k), ''),
      'signer', coalesce((select s.svalue from public.app_settings s where s.skey = 'disc_tmpl_config__signer_' || tk.k), 'Employee'),
      'reasons', coalesce((
        select jsonb_agg(jsonb_build_object('label', r.label, 'section', coalesce(r.svalue,''), 'sort', r.sort)
                         order by r.sort, r.label)
        from public.app_settings r where r.sgroup = 'disc_tmpl_' || tk.k), '[]'::jsonb),
      'coaching', coalesce((
        select jsonb_agg(jsonb_build_object('label', c.label, 'sort', c.sort)
                         order by c.sort, c.label)
        from public.app_settings c where c.sgroup = 'disc_tmpl_' || tk.k || '_coach'), '[]'::jsonb)
    ) order by tk.ord), '[]'::jsonb))
  into v_out
  from (values ('crew',1),('trainer',2),('shiftlead',3),('mgmt',4)) as tk(k,ord);

  return v_out;
end $fn$;
