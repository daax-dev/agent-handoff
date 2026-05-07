-- Migration 001: ChangeSet domain model

-- Jobs table (persistent SQLite mirror of the in-memory job store)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  transport TEXT NOT NULL,
  agent TEXT,
  agent_url TEXT,
  prompt TEXT NOT NULL,
  working_directory TEXT,
  model TEXT,
  spawn_mode TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 300000,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  pid INTEGER,
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  git_head_before TEXT,
  files_changed TEXT,
  diff_summary TEXT,
  a2a_task_id TEXT,
  artifacts TEXT,
  error TEXT,
  change_set_id TEXT
);

-- Sequences for zero-padded ID generation
CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sequences (name, value) VALUES ('change_set', 0);
INSERT OR IGNORE INTO sequences (name, value) VALUES ('task', 0);

-- ChangeSets table — the core PR-like domain object
CREATE TABLE IF NOT EXISTS change_sets (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL DEFAULT 'main',
  worktree_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  merged_at TEXT,
  github_issue_url TEXT,
  github_pr_url TEXT,
  remote_branch TEXT
);

-- SDLC Tasks — work items linked to a ChangeSet (distinct from job-runner jobs)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL REFERENCES change_sets(id),
  title TEXT NOT NULL,
  spec_path TEXT NOT NULL,
  plan_path TEXT,
  acceptance_path TEXT NOT NULL,
  assigned_agent TEXT,
  agent_role TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  created_at TEXT NOT NULL
);
