CREATE TABLE provider_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  scope_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL CHECK (length(input_fingerprint) = 64),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  retry_of_run_id TEXT,
  error_json TEXT,
  usage_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (id, project_id),
  FOREIGN KEY (retry_of_run_id, project_id)
    REFERENCES provider_runs(id, project_id) ON DELETE RESTRICT
);

CREATE INDEX provider_runs_project_idx
  ON provider_runs (project_id, created_at DESC, id ASC);

CREATE INDEX provider_runs_status_idx
  ON provider_runs (status, updated_at ASC, id ASC);

CREATE TABLE provider_run_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  provider_run_id TEXT NOT NULL UNIQUE REFERENCES provider_runs(id) ON DELETE CASCADE,
  output_json TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL CHECK (length(output_fingerprint) = 64),
  created_at TEXT NOT NULL
);

CREATE TRIGGER provider_run_candidates_immutable_update
BEFORE UPDATE ON provider_run_candidates
BEGIN
  SELECT RAISE(ABORT, 'provider run candidates are immutable');
END;
