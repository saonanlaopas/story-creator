import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { CreateProjectInput, ProjectEntryMode, ProjectRecord, SourceInspection, SourceMediaType } from "@story-creator/domain";
import { request, selectedProjectStorageKey, selectedSourceSegmentStorageKey } from "./api.js";
import { projectModeLabel, projectModes } from "./project-modes.js";
import { SourcePanel } from "./source-panel.js";
import { readSourceFile } from "./source-file.js";

export default function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [name, setName] = useState("");
  const [entryMode, setEntryMode] = useState<ProjectEntryMode>("premise");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceInspection[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [sourceFilename, setSourceFilename] = useState("pasted.txt");
  const [sourceMediaType, setSourceMediaType] = useState<SourceMediaType>("text/plain");
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceFileBlocked, setSourceFileBlocked] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

  const selectedId = selectedProject?.id;
  const selectedSummary = useMemo(() => selectedProject && projectModeLabel(selectedProject.entryMode), [selectedProject]);
  const selectedSource = sources[0] ?? null;

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await request<ProjectRecord[]>("/api/projects");
      setProjects(loaded);
      const storedId = window.localStorage.getItem(selectedProjectStorageKey);
      const storedProject = storedId ? loaded.find((project) => project.id === storedId) : undefined;
      if (storedProject) {
        setSelectedProject(storedProject);
      } else if (selectedId) {
        setSelectedProject(loaded.find((project) => project.id === selectedId) ?? null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
    // Loading the saved list once on mount also restores the selected project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSources([]);
      setSelectedSegmentId(null);
      return;
    }

    let active = true;
    setSourceLoading(true);
    setSourceError(null);
    void request<SourceInspection[]>(`/api/projects/${selectedId}/sources`)
      .then((loaded) => {
        if (!active) return;
        setSources(loaded);
        const source = loaded[0];
        const storedSegmentId = window.localStorage.getItem(selectedSourceSegmentStorageKey(selectedId));
        const storedSegment = source?.segments.find((segment) => segment.id === storedSegmentId);
        setSelectedSegmentId(storedSegment?.id ?? source?.segments[0]?.id ?? null);
      })
      .catch((loadError) => {
        if (!active) return;
        setSourceError(loadError instanceof Error ? loadError.message : "Could not load source documents");
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectProject = (project: ProjectRecord) => {
    setSelectedProject(project);
    window.localStorage.setItem(selectedProjectStorageKey, project.id);
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: CreateProjectInput = { name, entryMode };
      const created = await request<ProjectRecord>("/api/projects", {
        method: "POST",
        body: JSON.stringify(input)
      });
      setName("");
      setProjects((current) => [created, ...current]);
      selectProject(created);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not create project");
    } finally {
      setSaving(false);
    }
  };

  const handleSourceFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setSourceFileBlocked(true);
    try {
      const decoded = await readSourceFile(file);
      setSourceText(decoded.text);
      setSourceFilename(decoded.filename);
      setSourceMediaType(decoded.mediaType);
      setSourceFileBlocked(false);
      setSourceError(null);
    } catch (fileError) {
      setSourceText("");
      setSourceFilename("pasted.txt");
      setSourceMediaType("text/plain");
      setSourceFileBlocked(true);
      input.value = "";
      setSourceError(fileError instanceof Error ? fileError.message : "Could not read source file");
    }
  };

  const handleSourceTextChange = (text: string) => {
    setSourceText(text);
    if (sourceFileBlocked) {
      setSourceFileBlocked(false);
      setSourceError(null);
    }
  };

  const importSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedId || sourceFileBlocked) return;
    setSourceSaving(true);
    setSourceError(null);
    try {
      const created = await request<SourceInspection>(`/api/projects/${selectedId}/sources`, {
        method: "POST",
        body: JSON.stringify({
          filename: sourceFilename.trim() || "pasted.txt",
          mediaType: sourceMediaType,
          encoding: "utf-8",
          text: sourceText
        })
      });
      setSources((current) => [created, ...current.filter((source) => source.document.id !== created.document.id)]);
      const firstSegmentId = created.segments[0]?.id ?? null;
      setSelectedSegmentId(firstSegmentId);
      if (firstSegmentId) {
        window.localStorage.setItem(selectedSourceSegmentStorageKey(selectedId), firstSegmentId);
      }
      setSourceText("");
      setSourceFilename("pasted.txt");
      setSourceMediaType("text/plain");
      event.currentTarget.reset();
    } catch (saveError) {
      setSourceError(saveError instanceof Error ? saveError.message : "Could not import source");
    } finally {
      setSourceSaving(false);
    }
  };

  const selectSourceSegment = (segmentId: string) => {
    setSelectedSegmentId(segmentId);
    if (selectedId) {
      window.localStorage.setItem(selectedSourceSegmentStorageKey(selectedId), segmentId);
    }
  };

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Local-first writing workspace</p>
        <h1>Story Creator</h1>
        <p>Create a project, close the app, and pick it up again whenever you are ready.</p>
      </header>

      {error && <p className="notice error" role="alert">{error}</p>}

      <div className="layout">
        <section className="panel" aria-labelledby="create-heading">
          <h2 id="create-heading">Create a project</h2>
          <form onSubmit={(event) => void createProject(event)}>
            <label htmlFor="project-name">Project name</label>
            <input
              id="project-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="A title for your story"
              required
            />

            <fieldset>
              <legend>How would you like to begin?</legend>
              <div className="mode-grid">
                {projectModes.map((mode) => (
                  <label className={`mode-card ${entryMode === mode.value ? "selected" : ""}`} key={mode.value}>
                    <input
                      type="radio"
                      name="entryMode"
                      value={mode.value}
                      checked={entryMode === mode.value}
                      onChange={() => setEntryMode(mode.value)}
                    />
                    <span>
                      <strong>{mode.label}</strong>
                      <small>{mode.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" disabled={saving}>{saving ? "Saving…" : "Create project"}</button>
          </form>
        </section>

        <section className="panel" aria-labelledby="saved-heading">
          <div className="section-heading">
            <h2 id="saved-heading">Saved projects</h2>
            <button className="secondary" type="button" onClick={() => void loadProjects()} disabled={loading}>Refresh</button>
          </div>
          {loading ? <p className="muted" role="status">Loading saved projects…</p> : projects.length === 0 ? (
            <p className="muted">No projects yet. Create one to get started.</p>
          ) : (
            <ul className="project-list">
              {projects.map((project) => (
                <li key={project.id} className={project.id === selectedId ? "active" : ""}>
                  <div>
                    <strong>{project.name}</strong>
                    <small>{projectModeLabel(project.entryMode)}</small>
                  </div>
                  <button className="secondary" type="button" onClick={() => selectProject(project)}>Open</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel selected-panel" aria-labelledby="selected-heading">
        <h2 id="selected-heading">Selected project</h2>
        {selectedProject ? (
          <div className="selected-card">
            <div>
              <p className="eyebrow">Ready to reopen</p>
              <h3>{selectedProject.name}</h3>
              <p>{selectedSummary}</p>
            </div>
            <dl>
              <div><dt>Status</dt><dd>{selectedProject.status}</dd></div>
              <div><dt>Created</dt><dd>{new Date(selectedProject.createdAt).toLocaleString()}</dd></div>
            </dl>
          </div>
        ) : <p className="muted">Choose Open on a saved project to view it here.</p>}
      </section>

      <SourcePanel
        project={selectedProject}
        source={selectedSource}
        sourceText={sourceText}
        filename={sourceFilename}
        sourceError={sourceError}
        sourceLoading={sourceLoading}
        sourceSaving={sourceSaving}
        selectedSegmentId={selectedSegmentId}
        onFileChange={(event) => void handleSourceFileChange(event)}
        onTextChange={handleSourceTextChange}
        onImport={(event) => void importSource(event)}
        onSelectSegment={selectSourceSegment}
      />
    </main>
  );
}
