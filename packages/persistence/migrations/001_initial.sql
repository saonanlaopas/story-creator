CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  entry_mode TEXT NOT NULL CHECK (entry_mode IN ('premise', 'import-mend', 'import-continue')),
  status TEXT NOT NULL CHECK (status IN ('active')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX projects_updated_at_idx ON projects (updated_at DESC, id ASC);
