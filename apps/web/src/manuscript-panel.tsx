import { useEffect, useRef, useState } from "react";
import { manuscriptDraftSchema, type ManuscriptDraft, type ManuscriptView, type ProjectRecord, type SourceInspection } from "@story-creator/domain";
import {
  checkpointManuscriptUnit,
  initializeManuscript,
  loadManuscript,
  saveManuscriptDraft
} from "./manuscript-api.js";
import { ApiRequestError, selectedManuscriptUnitStorageKey } from "./api.js";

type SaveState = "saved" | "saving" | "failed";

export interface ManuscriptPanelProps {
  project: ProjectRecord | null;
  source: SourceInspection | null;
  onRegisterNavigationGuard?: (flush: () => Promise<boolean>) => () => void;
}

interface PendingSave {
  unitId: string;
  prose: string;
}

interface DraftConflict {
  unitId: string;
  currentDraft: ManuscriptDraft;
}

function conflictDraftFromError(error: unknown): ManuscriptDraft | null {
  if (!(error instanceof ApiRequestError) || error.body.code !== "DRAFT_REVISION_CONFLICT") return null;
  const parsed = manuscriptDraftSchema.safeParse(error.body.currentDraft);
  return parsed.success ? parsed.data : null;
}

function selectedUnit(manuscript: ManuscriptView | null, unitId: string | null) {
  return manuscript?.units.find((unit) => unit.unit.id === unitId) ?? manuscript?.units[0];
}

export function ManuscriptPanel({ project, source, onRegisterNavigationGuard }: ManuscriptPanelProps) {
  const projectId = project?.id;
  const [manuscript, setManuscript] = useState<ManuscriptView | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [checkpointing, setCheckpointing] = useState(false);
  const [checkpointMessage, setCheckpointMessage] = useState<string | null>(null);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [draftConflict, setDraftConflict] = useState<DraftConflict | null>(null);
  const draftConflictRef = useRef<DraftConflict | null>(null);
  const manuscriptRef = useRef<ManuscriptView | null>(null);
  const selectedUnitIdRef = useRef<string | null>(null);
  const draftTextRef = useRef("");
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const timerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const saveImplementationRef = useRef<() => Promise<boolean>>(async () => true);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  const updateDraftConflict = (next: DraftConflict | null) => {
    draftConflictRef.current = next;
    setDraftConflict(next);
  };

  const updateManuscript = (next: ManuscriptView | null) => {
    manuscriptRef.current = next;
    setManuscript(next);
  };

  const updatePersistedDraft = (unitId: string, draft: ManuscriptDraft) => {
    const current = manuscriptRef.current;
    if (!current) return;
    updateManuscript({
      ...current,
      units: current.units.map((candidate) => candidate.unit.id === unitId ? { ...candidate, draft } : candidate)
    });
  };

  const updateSelectedUnit = (unitId: string | null, nextManuscript: ManuscriptView | null = manuscriptRef.current) => {
    selectedUnitIdRef.current = unitId;
    setSelectedUnitId(unitId);
    const unit = selectedUnit(nextManuscript, unitId);
    const prose = unit?.draft.prose ?? "";
    draftTextRef.current = prose;
    setDraftText(prose);
  };

  useEffect(() => {
    if (!projectId) {
      updateManuscript(null);
      updateSelectedUnit(null, null);
      setLoading(false);
      setError(null);
      setCheckpointMessage(null);
      updateDraftConflict(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setCheckpointMessage(null);
    void loadManuscript(projectId)
      .then((loaded) => {
        if (!active) return;
        updateManuscript(loaded);
        if (!loaded) {
          updateSelectedUnit(null, null);
          return;
        }
        const storedId = window.localStorage.getItem(selectedManuscriptUnitStorageKey(projectId));
        const storedUnit = loaded.units.find((unit) => unit.unit.id === storedId);
        const firstUnit = storedUnit ?? loaded.units[0];
        const nextUnitId = firstUnit?.unit.id ?? null;
        updateSelectedUnit(nextUnitId, loaded);
        setSaveState("saved");
        updateDraftConflict(null);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load the working manuscript");
        updateManuscript(null);
        updateSelectedUnit(null, null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  const scheduleSave = (delay = 350) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const promise = savePromiseRef.current ?? saveImplementationRef.current();
      savePromiseRef.current = promise;
      void promise.then(
        () => {
          if (savePromiseRef.current === promise) savePromiseRef.current = null;
        },
        () => {
          if (savePromiseRef.current === promise) savePromiseRef.current = null;
        }
      );
    }, delay);
  };

  const saveImplementation = async (): Promise<boolean> => {
    const currentProjectId = projectId;
    const pending = pendingSaveRef.current;
    if (!currentProjectId || !pending) return true;
    pendingSaveRef.current = null;
    const currentManuscript = manuscriptRef.current;
    const unit = currentManuscript?.units.find((candidate) => candidate.unit.id === pending.unitId);
    if (!unit) return false;

    setSaveState("saving");
    try {
      const result = await saveManuscriptDraft(currentProjectId, pending.unitId, {
        prose: pending.prose,
        expectedRevision: unit.draft.revision
      });
      updateManuscript(result.manuscript);
      setError(null);
      updateDraftConflict(null);
      if (pendingSaveRef.current) {
        setSaveState("saving");
        scheduleSave(0);
      } else {
        setSaveState("saved");
      }
      return true;
    } catch (saveError) {
      pendingSaveRef.current = pendingSaveRef.current ?? {
        unitId: pending.unitId,
        prose: draftTextRef.current
      };
      const currentDraft = conflictDraftFromError(saveError);
      if (currentDraft?.manuscriptUnitId === pending.unitId) {
        updatePersistedDraft(pending.unitId, currentDraft);
        updateDraftConflict({ unitId: pending.unitId, currentDraft });
        setError(null);
      } else {
        updateDraftConflict(null);
        setError(saveError instanceof Error ? saveError.message : "Could not save the manuscript draft");
      }
      setSaveState("failed");
      return false;
    }
  };

  saveImplementationRef.current = saveImplementation;

  const startSave = (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    const promise = saveImplementationRef.current();
    savePromiseRef.current = promise;
    void promise.then(
      () => {
        if (savePromiseRef.current === promise) savePromiseRef.current = null;
      },
      () => {
        if (savePromiseRef.current === promise) savePromiseRef.current = null;
      }
    );
    return promise;
  };

  const flushPendingSave = async (): Promise<boolean> => {
    if (draftConflictRef.current) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return false;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    while (savePromiseRef.current || pendingSaveRef.current) {
      if (savePromiseRef.current) {
        if (!(await savePromiseRef.current)) return false;
        continue;
      }
      if (!(await startSave())) return false;
    }
    return true;
  };

  const saveLocalVersion = async (): Promise<boolean> => {
    if (!draftConflictRef.current || !pendingSaveRef.current) return false;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return startSave();
  };

  flushRef.current = flushPendingSave;

  useEffect(() => {
    if (!onRegisterNavigationGuard) return;
    const guard = () => flushRef.current();
    return onRegisterNavigationGuard(guard);
  }, [onRegisterNavigationGuard]);

  useEffect(() => {
    const handlePageHide = () => {
      void flushRef.current();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void flushRef.current();
    };
  }, []);

  const handleTextChange = (text: string) => {
    const unitId = selectedUnitIdRef.current;
    if (!unitId) return;
    draftTextRef.current = text;
    setDraftText(text);
    pendingSaveRef.current = { unitId, prose: text };
    setCheckpointMessage(null);
    setCheckpointError(null);
    if (draftConflictRef.current) {
      setSaveState("failed");
      return;
    }
    setSaveState("saving");
    scheduleSave();
  };

  const handleSelectUnit = async (unitId: string) => {
    if (unitId === selectedUnitIdRef.current) return;
    if (!(await flushPendingSave())) return;
    selectedUnitIdRef.current = unitId;
    setSelectedUnitId(unitId);
    if (projectId) window.localStorage.setItem(selectedManuscriptUnitStorageKey(projectId), unitId);
    const unit = selectedUnit(manuscriptRef.current, unitId);
    const prose = unit?.draft.prose ?? "";
    draftTextRef.current = prose;
    setDraftText(prose);
    setSaveState("saved");
    updateDraftConflict(null);
    setCheckpointMessage(null);
    setCheckpointError(null);
  };

  const handleInitialize = async () => {
    if (!projectId || !source) return;
    setInitializing(true);
    setError(null);
    try {
      const created = await initializeManuscript(projectId, { sourceDocumentId: source.document.id });
      updateManuscript(created);
      const firstUnitId = created.units[0]?.unit.id ?? null;
      updateSelectedUnit(firstUnitId, created);
      if (firstUnitId) window.localStorage.setItem(selectedManuscriptUnitStorageKey(projectId), firstUnitId);
      setSaveState("saved");
      updateDraftConflict(null);
    } catch (initializeError) {
      setError(initializeError instanceof Error ? initializeError.message : "Could not create the working manuscript");
    } finally {
      setInitializing(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    void (draftConflictRef.current ? saveLocalVersion() : flushPendingSave());
  };

  const handleLoadPersistedDraft = () => {
    const conflict = draftConflictRef.current;
    if (!conflict) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingSaveRef.current = null;
    draftTextRef.current = conflict.currentDraft.prose;
    setDraftText(conflict.currentDraft.prose);
    updatePersistedDraft(conflict.unitId, conflict.currentDraft);
    updateDraftConflict(null);
    setError(null);
    setSaveState("saved");
  };

  const handleCheckpoint = async () => {
    const currentProjectId = projectId;
    const unitId = selectedUnitIdRef.current;
    if (!currentProjectId || !unitId) return;
    setCheckpointing(true);
    setCheckpointError(null);
    setCheckpointMessage(null);
    if (!(await flushPendingSave())) {
      setCheckpointError("Checkpoint could not be created because the draft save failed. Retry the save first.");
      setCheckpointing(false);
      return;
    }
    try {
      const result = await checkpointManuscriptUnit(currentProjectId, unitId);
      updateManuscript(result.manuscript);
      setCheckpointMessage(result.created ? "Checkpoint created" : "Checkpoint reused; no duplicate version was created");
      setSaveState("saved");
    } catch (checkpointErrorValue) {
      setCheckpointError(checkpointErrorValue instanceof Error ? checkpointErrorValue.message : "Could not create checkpoint");
    } finally {
      setCheckpointing(false);
    }
  };

  const unit = selectedUnit(manuscript, selectedUnitId);
  const sourceComparison = unit?.sourceComparison;

  return (
    <section className="panel manuscript-panel" aria-labelledby="manuscript-heading">
      <h2 id="manuscript-heading">Working manuscript</h2>
      {!project ? <p className="muted">Create or open a project to edit its working manuscript.</p> : loading ? (
        <p className="muted" role="status">Loading manuscript...</p>
      ) : !source ? (
        <p className="muted">Import a source before creating the working manuscript.</p>
      ) : !manuscript ? (
        <>
          <p className="muted">Create an editable manuscript from the immutable source outline.</p>
          <button type="button" onClick={() => void handleInitialize()} disabled={initializing}>
            {initializing ? "Creating manuscript..." : "Create working manuscript"}
          </button>
          {error && <p className="notice error" role="alert">{error}</p>}
        </>
      ) : (
        <>
          <div className="manuscript-summary">
            <p className="muted">One ordered manuscript level · structure revision {manuscript.structure.revision}</p>
            <button type="button" onClick={() => void handleCheckpoint()} disabled={checkpointing || !unit}>
              {checkpointing ? "Checkpointing..." : "Create checkpoint"}
            </button>
          </div>
          {error && <p className="notice error" role="alert">{error}</p>}
          {checkpointError && <p className="notice error" role="alert">{checkpointError}</p>}
          {draftConflict && (
            <div className="notice warning" role="alert" data-testid="manuscript-conflict">
              <strong>Draft conflict</strong>
              <p>
                Another save advanced the persisted draft to revision {draftConflict.currentDraft.revision}. Your local prose is still visible.
                Save local version will retry it against the current revision.
              </p>
              <button className="secondary" type="button" onClick={handleLoadPersistedDraft}>
                Load persisted draft (discard local text)
              </button>
            </div>
          )}
          {checkpointMessage && <p className="notice success" role="status" data-testid="checkpoint-result">{checkpointMessage}</p>}
          <div className="manuscript-reader-grid">
            <nav aria-label="Manuscript outline">
              <h3>Manuscript outline</h3>
              <ol className="source-outline">
                {manuscript.units.map((candidate) => (
                  <li key={candidate.unit.id}>
                    <button
                      className={`outline-item ${candidate.unit.id === unit?.unit.id ? "selected" : ""}`}
                      type="button"
                      aria-current={candidate.unit.id === unit?.unit.id ? "true" : undefined}
                      onClick={() => void handleSelectUnit(candidate.unit.id)}
                    >
                      <strong>{candidate.currentVersion.title ?? `Unit ${candidate.unit.position + 1}`}</strong>
                      <small>Unit {candidate.unit.position + 1} · draft revision {candidate.draft.revision}</small>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="manuscript-editor-column">
              {unit ? (
                <>
                  <div className="editor-heading">
                    <div>
                      <h3>{unit.currentVersion.title ?? `Unit ${unit.unit.position + 1}`}</h3>
                      <p className="muted">Current version {unit.currentVersion.versionNumber} · draft revision {unit.draft.revision}</p>
                    </div>
                    <p className={`save-state ${saveState}`} role="status" data-testid="manuscript-save-state">
                      {saveState === "saving" ? "Saving" : saveState === "failed" ? "Save failed" : "Saved"}
                    </p>
                  </div>
                  <label htmlFor="manuscript-prose">Manuscript prose</label>
                  <textarea
                    id="manuscript-prose"
                    data-testid="manuscript-editor"
                    value={draftText}
                    onChange={(event) => handleTextChange(event.target.value)}
                    rows={14}
                  />
                  {saveState === "failed" && (
                    <button className="secondary retry-button" type="button" onClick={handleRetry}>
                      {draftConflict ? "Save local version" : "Retry save"}
                    </button>
                  )}

                  <section className="source-comparison" aria-labelledby="manuscript-source-heading">
                    <h3 id="manuscript-source-heading">Immutable source comparison</h3>
                    {sourceComparison ? (
                      <>
                        <p className="muted">{sourceComparison.document.filename} · source segment {sourceComparison.segment.position + 1}</p>
                        <pre data-testid="manuscript-source-comparison">{sourceComparison.segment.text}</pre>
                      </>
                    ) : <p className="muted">No source provenance is attached to this unit.</p>}
                  </section>
                </>
              ) : <p className="muted">No manuscript unit is available.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
