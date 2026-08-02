CREATE TABLE source_documents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL CHECK (length(trim(filename)) > 0),
  media_type TEXT NOT NULL CHECK (media_type IN ('text/plain', 'text/markdown')),
  encoding TEXT NOT NULL CHECK (encoding = 'utf-8'),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  normalized_text_hash TEXT NOT NULL CHECK (length(normalized_text_hash) = 64),
  normalized_text TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX source_documents_project_idx ON source_documents (project_id, created_at DESC, id ASC);

CREATE TABLE source_segmentations (
  id TEXT PRIMARY KEY NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  algorithm_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source_document_id, algorithm_version),
  UNIQUE (id, source_document_id)
);

CREATE TABLE source_segments (
  id TEXT NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  segmentation_version_id TEXT NOT NULL REFERENCES source_segmentations(id) ON DELETE CASCADE,
  parent_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('chapter', 'scene', 'unknown')),
  position INTEGER NOT NULL CHECK (position >= 0),
  heading TEXT,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  content TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  PRIMARY KEY (source_document_id, id),
  FOREIGN KEY (segmentation_version_id, source_document_id)
    REFERENCES source_segmentations(id, source_document_id) ON DELETE CASCADE,
  FOREIGN KEY (source_document_id, parent_id)
    REFERENCES source_segments(source_document_id, id) ON DELETE CASCADE,
  FOREIGN KEY (segmentation_version_id, parent_id)
    REFERENCES source_segments(segmentation_version_id, id) ON DELETE CASCADE,
  UNIQUE (segmentation_version_id, position),
  UNIQUE (segmentation_version_id, id)
);

CREATE INDEX source_segments_document_idx ON source_segments (source_document_id, position ASC);

CREATE TRIGGER source_documents_immutable_update
BEFORE UPDATE ON source_documents
BEGIN
  SELECT RAISE(ABORT, 'source documents are immutable');
END;

CREATE TRIGGER source_segmentations_immutable_update
BEFORE UPDATE ON source_segmentations
BEGIN
  SELECT RAISE(ABORT, 'source segmentations are immutable');
END;

CREATE TRIGGER source_segments_immutable_update
BEFORE UPDATE ON source_segments
BEGIN
  SELECT RAISE(ABORT, 'source segments are immutable');
END;
