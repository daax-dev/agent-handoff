-- Migration 010: add spec_content to change_sets for GitHub issue import
ALTER TABLE change_sets ADD COLUMN spec_content TEXT;
