CREATE UNIQUE INDEX source_documents_id_project_unique
  ON source_documents (id, project_id);

CREATE TABLE manuscript_units (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_document_id TEXT,
  source_segment_id TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  current_version_id TEXT NOT NULL,
  accepted_version_id TEXT,
  created_at TEXT NOT NULL,
  CHECK ((source_document_id IS NULL) = (source_segment_id IS NULL)),
  UNIQUE (project_id, id),
  UNIQUE (id, source_document_id),
  UNIQUE (project_id, position),
  UNIQUE (source_document_id, source_segment_id),
  FOREIGN KEY (source_document_id, project_id)
    REFERENCES source_documents(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (source_document_id, source_segment_id)
    REFERENCES source_segments(source_document_id, id) ON DELETE CASCADE,
  FOREIGN KEY (id, current_version_id)
    REFERENCES manuscript_unit_versions(manuscript_unit_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id, accepted_version_id)
    REFERENCES manuscript_unit_versions(manuscript_unit_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE manuscript_unit_versions (
  id TEXT PRIMARY KEY NOT NULL,
  manuscript_unit_id TEXT NOT NULL REFERENCES manuscript_units(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT,
  prose TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  source_document_id TEXT,
  source_segment_id TEXT,
  created_at TEXT NOT NULL,
  restored_from_version_id TEXT,
  CHECK ((source_document_id IS NULL) = (source_segment_id IS NULL)),
  UNIQUE (manuscript_unit_id, id),
  UNIQUE (manuscript_unit_id, version_number),
  FOREIGN KEY (manuscript_unit_id, source_document_id)
    REFERENCES manuscript_units(id, source_document_id) ON DELETE CASCADE,
  FOREIGN KEY (source_document_id, source_segment_id)
    REFERENCES source_segments(source_document_id, id) ON DELETE CASCADE,
  FOREIGN KEY (manuscript_unit_id, restored_from_version_id)
    REFERENCES manuscript_unit_versions(manuscript_unit_id, id) ON DELETE CASCADE
);

CREATE TABLE manuscript_drafts (
  manuscript_unit_id TEXT PRIMARY KEY NOT NULL REFERENCES manuscript_units(id) ON DELETE CASCADE,
  prose TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  updated_at TEXT NOT NULL
);

CREATE TABLE manuscript_structures (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_document_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_document_id, project_id)
    REFERENCES source_documents(id, project_id) ON DELETE CASCADE
);

CREATE TABLE manuscript_unit_order (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  manuscript_unit_id TEXT NOT NULL,
  PRIMARY KEY (project_id, position),
  UNIQUE (project_id, manuscript_unit_id),
  FOREIGN KEY (project_id, manuscript_unit_id)
    REFERENCES manuscript_units(project_id, id) ON DELETE CASCADE
);

CREATE INDEX manuscript_units_project_idx ON manuscript_units (project_id, position ASC);
CREATE INDEX manuscript_versions_unit_idx ON manuscript_unit_versions (manuscript_unit_id, version_number DESC);
CREATE INDEX manuscript_drafts_updated_idx ON manuscript_drafts (updated_at DESC, manuscript_unit_id ASC);

CREATE TRIGGER manuscript_unit_versions_immutable_update
BEFORE UPDATE ON manuscript_unit_versions
BEGIN
  SELECT RAISE(ABORT, 'manuscript unit versions are immutable');
END;

CREATE TRIGGER manuscript_drafts_revision_monotonic
BEFORE UPDATE ON manuscript_drafts
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'manuscript draft revision must increase');
END;

CREATE TRIGGER manuscript_structures_revision_monotonic
BEFORE UPDATE ON manuscript_structures
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'manuscript structure revision must increase');
END;
