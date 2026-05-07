-- Migration 013: Seed default agent assignments for GSD mode states

INSERT OR IGNORE INTO agent_assignments (id, fsm_state, role, tool, enabled, updated_at) VALUES
  ('aa_project_init_researcher',     'project_init',       'researcher',     'claude-code', 1, datetime('now')),
  ('aa_project_init_pm_planner',     'project_init',       'pm_planner',     'claude-code', 1, datetime('now')),
  ('aa_discussing_pm_planner',       'discussing',         'pm_planner',     'claude-code', 1, datetime('now')),
  ('aa_planning_researcher',         'planning',           'researcher',     'claude-code', 1, datetime('now')),
  ('aa_planning_planner',            'planning',           'planner',        'claude-code', 1, datetime('now')),
  ('aa_planning_plan_verifier',      'planning',           'plan_verifier',  'claude-code', 1, datetime('now')),
  ('aa_executing_implementer',       'executing',          'implementer',    'claude-code', 1, datetime('now')),
  ('aa_verifying_verifier',          'verifying',          'verifier',       'claude-code', 1, datetime('now')),
  ('aa_verifying_qa_agent',          'verifying',          'qa_agent',       'claude-code', 1, datetime('now')),
  ('aa_gap_fixing_fixer',            'gap_fixing',         'fixer',          'claude-code', 1, datetime('now')),
  ('aa_shipping_summarizer',         'shipping',           'summarizer',     'claude-code', 1, datetime('now')),
  ('aa_shipping_pr_builder',         'shipping',           'pr_builder',     'claude-code', 1, datetime('now'));
