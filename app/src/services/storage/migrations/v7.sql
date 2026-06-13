-- Gimbo SQLite schema v7 (M-45 — saved custom periods)
-- Adds the saved_periods table: named custom date ranges saved from the Reports period
-- picker for reuse. Applied incrementally on top of v6.

CREATE TABLE IF NOT EXISTS saved_periods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

PRAGMA user_version = 7;
