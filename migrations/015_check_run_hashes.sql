-- Migration 015: Add content-addressing to check_runs
ALTER TABLE check_runs ADD COLUMN output_sha256 TEXT;
ALTER TABLE check_runs ADD COLUMN subject_commit TEXT;
