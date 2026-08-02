import type { ChangeEvent, FormEvent } from "react";
import type { ProjectRecord, SourceInspection } from "@story-creator/domain";

export interface SourcePanelProps {
  project: ProjectRecord | null;
  source: SourceInspection | null;
  sourceText: string;
  filename: string;
  sourceError: string | null;
  sourceLoading: boolean;
  sourceSaving: boolean;
  selectedSegmentId: string | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTextChange: (text: string) => void;
  onImport: (event: FormEvent<HTMLFormElement>) => void;
  onSelectSegment: (segmentId: string) => void;
}

export function SourcePanel({
  project,
  source,
  sourceText,
  filename,
  sourceError,
  sourceLoading,
  sourceSaving,
  selectedSegmentId,
  onFileChange,
  onTextChange,
  onImport,
  onSelectSegment
}: SourcePanelProps) {
  const selectedSegment = source?.segments.find((segment) => segment.id === selectedSegmentId) ?? source?.segments[0];

  return (
    <section className="panel source-panel" aria-labelledby="source-heading">
      <h2 id="source-heading">Story source</h2>
      {!project ? <p className="muted">Create or open a project to import a source.</p> : (
        <>
          <form onSubmit={onImport}>
            <label htmlFor="source-file">UTF-8 TXT or Markdown file</label>
            <input id="source-file" name="sourceFile" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={onFileChange} />
            <label htmlFor="source-text">Paste source text</label>
            <textarea
              id="source-text"
              name="sourceText"
              value={sourceText}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="Paste a story here, including its chapter or scene headings."
              rows={7}
            />
            <p className="muted source-help">Stored filename: {filename}. Line endings are normalized to LF. Imported source is immutable after creation.</p>
            <button type="submit" disabled={sourceSaving}>{sourceSaving ? "Importing..." : "Import source"}</button>
          </form>

          {sourceError && <p className="notice error" role="alert">{sourceError}</p>}
          {sourceLoading ? <p className="muted" role="status">Loading source...</p> : source ? (
            <div className="source-reader">
              <div className="source-summary">
                <div>
                  <p className="eyebrow">Immutable source</p>
                  <h3>{source.document.filename}</h3>
                  <p className="muted">{source.document.mediaType} · {source.document.encoding}</p>
                </div>
                <dl>
                  <div><dt>Segments</dt><dd>{source.segments.length}</dd></div>
                  <div><dt>Algorithm</dt><dd>{source.segmentation.algorithmVersion}</dd></div>
                </dl>
              </div>

              {source.document.warnings.length > 0 && (
                <div className="notice warning" role="status">
                  <strong>Import warnings</strong>
                  <ul>{source.document.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              )}

              <div className="source-reader-grid">
                <nav aria-label="Source outline">
                  <h3>Source outline</h3>
                  <ol className="source-outline">
                    {source.segments.map((segment) => (
                      <li key={segment.id}>
                        <button
                          className={`outline-item ${segment.id === selectedSegment?.id ? "selected" : ""}`}
                          type="button"
                          aria-current={segment.id === selectedSegment?.id ? "true" : undefined}
                          onClick={() => onSelectSegment(segment.id)}
                        >
                          <strong>{segment.heading ?? `${segment.kind} ${segment.position + 1}`}</strong>
                          <small>{segment.kind} · UTF-16 {segment.startOffset}-{segment.endOffset}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                </nav>

                <div className="source-detail">
                  {selectedSegment ? (
                    <>
                      <h3>Selected source segment</h3>
                      <p className="muted">{selectedSegment.kind} · UTF-16 offsets {selectedSegment.startOffset}-{selectedSegment.endOffset}</p>
                      <pre data-testid="selected-source-segment">{selectedSegment.text}</pre>
                    </>
                  ) : <p className="muted">No source segment is available.</p>}
                  <h3>Normalized source</h3>
                  <pre data-testid="normalized-source">{source.document.normalizedText}</pre>
                  <p className="source-hash muted">Normalized SHA-256: {source.document.normalizedTextHash}</p>
                </div>
              </div>
            </div>
          ) : <p className="muted">No source imported yet.</p>}
        </>
      )}
    </section>
  );
}
