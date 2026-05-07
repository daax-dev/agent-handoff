-- Migration 004: Expand review_comments table (PRD-010)
-- Adds resolved_by and resolved_at columns; severity CHECK enforced at app layer.

ALTER TABLE review_comments ADD COLUMN resolved_by TEXT;
ALTER TABLE review_comments ADD COLUMN resolved_at TEXT;

INSERT OR IGNORE INTO sequences (name, value) VALUES ('review_comments', 0);
