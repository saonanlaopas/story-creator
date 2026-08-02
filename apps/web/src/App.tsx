import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { CreateProjectInput, ProjectEntryMode, ProjectRecord } from "@story-creator/domain";

const modes: Array<{ value: ProjectEntryMode; label: string; description: string }> = [
  { value: "premise", label: "Start from a premise", description: "Begin with a new idea and build the story foundation." },
  { value: "import-mend", label: "Import and mend", description: "Bring in existing work and plan focused repairs later." },
  { value: "import-continue", label: "Import and continue", description: "Bring in existing work and continue from a clear boundary later." }
];

const selectedStorageKey = "story-creator:selected-project";

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function modeLabel(entryMode: ProjectEntryMode): string {
  return modes.find((mode) => mode.value === entryMode)?.label ?? entryMode;
}

export default function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [name, setName] = useState("");
  const [entryMode, setEntryMode] = useState<ProjectEntryMode>("premise");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = selectedProject?.id;
  const selectedSummary = useMemo(() => selectedProject && modeLabel(selectedProject.entryMode), [selectedProject]);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await request<ProjectRecord[]>("/api/projects");
      setProjects(loaded);
      const storedId = window.localStorage.getItem(selectedStorageKey);
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

  const selectProject = (project: ProjectRecord) => {
    setSelectedProject(project);
    window.localStorage.setItem(selectedStorageKey, project.id);
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
                {modes.map((mode) => (
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
                    <small>{modeLabel(project.entryMode)}</small>
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
    </main>
  );
}
