"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  WEBSITE_OWNER_CHIPS,
  blankDraft,
  deskToday,
  formatDeskDate,
  isClientWait,
  isOverdue,
  joinPeople,
  matchesPerson,
  ownerNames,
  projectToDraft,
  stageLabel,
  stagesFor,
  type WebsiteBoard,
  type WebsiteDraft,
  type WebsiteProject,
} from "@/lib/website-ops-model";

type ClientOption = { id: string; name: string };

type DeskData = {
  today: string;
  projects: WebsiteProject[];
  clients: ClientOption[];
  meName: string | null;
};

const EMPTY_PROJECTS: WebsiteProject[] = [];

type EditorState = {
  id: string | null;
  draft: WebsiteDraft;
  more: boolean;
  actions: boolean;
  error: string;
};

function haystack(project: WebsiteProject): string {
  return [project.name, project.clientName, project.owners, project.nextStep, project.waitingOn, project.blockers]
    .join("\n")
    .toLowerCase();
}

function isQuiet(project: WebsiteProject): boolean {
  if (project.disposition !== "active") return true;
  return project.stage === "launched" || project.stage === "done" || project.stage === "paused";
}

function byDue(a: WebsiteProject, b: WebsiteProject): number {
  if (a.targetOn && b.targetOn && a.targetOn !== b.targetOn) return a.targetOn < b.targetOn ? -1 : 1;
  if (a.targetOn !== b.targetOn) return a.targetOn ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function signal(project: WebsiteProject, today: string): "" | "overdue" | "waiting" {
  if (isOverdue(project, today)) return "overdue";
  if (isClientWait(project)) return "waiting";
  return "";
}

export function WebsiteDesk() {
  const [data, setData] = useState<DeskData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [board, setBoard] = useState<WebsiteBoard>("website");
  const [owner, setOwner] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [importer, setImporter] = useState(false);
  const [quietOpen, setQuietOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/website");
    if (!res.ok) {
      setLoadError("Couldn't load projects.");
      return;
    }
    const body = (await res.json()) as DeskData;
    setData(body);
    setLoadError("");
  }

  useEffect(() => {
    void load().catch(() => setLoadError("Couldn't load projects."));
  }, []);

  const editorKey = editor ? editor.id || "new" : "";
  useEffect(() => {
    if (!editorKey) return;
    nameRef.current?.focus();
  }, [editorKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 1600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const today = data?.today || deskToday();
  const projects = data?.projects ?? EMPTY_PROJECTS;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (project.board !== board) return false;
      if (!matchesPerson(project, owner)) return false;
      if (q && !haystack(project).includes(q)) return false;
      return true;
    });
  }, [projects, board, owner, query]);

  const active = visible.filter((project) => !isQuiet(project));
  const quiet = visible.filter(isQuiet);
  const stages = stagesFor(board).filter((stage) => stage.key !== "launched" && stage.key !== "done" && stage.key !== "paused");

  function replaceProject(project: WebsiteProject) {
    setData((current) =>
      current
        ? { ...current, projects: current.projects.map((item) => (item.id === project.id ? project : item)) }
        : current
    );
  }

  function openNew() {
    const draft = blankDraft(board);
    if (data?.meName) draft.owners = data.meName;
    setEditor({ id: null, draft, more: false, actions: false, error: "" });
  }

  function openProject(project: WebsiteProject) {
    const draft = projectToDraft(project);
    draft.owners = joinPeople(ownerNames(draft.owners));
    setEditor({ id: project.id, draft, more: false, actions: false, error: "" });
  }

  async function saveEditor(patch?: Partial<WebsiteDraft>) {
    if (!editor) return;
    setBusy(true);
    const draft = { ...editor.draft, ...patch };
    const res = await fetch(editor.id ? `/api/website/${editor.id}` : "/api/website", {
      method: editor.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setEditor({ ...editor, draft, error: body.error || "Couldn't save that." });
      return;
    }
    if (editor.id) replaceProject(body.project);
    else setData((current) => (current ? { ...current, projects: [...current.projects, body.project] } : current));
    setEditor(null);
    setNotice("Saved");
  }

  async function removeProject() {
    if (!editor?.id) return;
    if (!window.confirm(`Delete ${editor.draft.name || "this project"}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/website/${editor.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setEditor({ ...editor, error: "Couldn't delete that." });
      return;
    }
    const id = editor.id;
    setData((current) => (current ? { ...current, projects: current.projects.filter((item) => item.id !== id) } : current));
    setEditor(null);
    setNotice("Deleted");
  }

  return (
    <main className="container container-wide webops">
      <header className="webops-top">
        <h1>Website Ops</h1>
        <div className="webops-top-actions">
          <div className="webops-kind" role="group" aria-label="Project type">
            <button type="button" aria-pressed={board === "website"} onClick={() => setBoard("website")}>
              Websites
            </button>
            <button type="button" aria-pressed={board === "landing"} onClick={() => setBoard("landing")}>
              Landing pages
            </button>
          </div>
          <button type="button" className="btn" onClick={openNew}>
            Add project
          </button>
        </div>
      </header>

      <div className="webops-bar">
        <label className="webops-search">
          <span className="sr-only">Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            type="search"
          />
        </label>
        <label className="webops-owner-filter">
          <span>Owner</span>
          <select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Owner">
            <option value="">Everyone</option>
            {WEBSITE_OWNER_CHIPS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value="__none">No owner</option>
          </select>
        </label>
      </div>

      {notice ? (
        <p className="webops-notice" role="status">
          {notice}
        </p>
      ) : null}
      {loadError ? (
        <p className="error" role="alert">
          {loadError}{" "}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}

      {!data ? (
        <p className="webops-sub">Loading projects…</p>
      ) : projects.length === 0 ? (
        <section className="webops-empty">
          <h2>No projects yet</h2>
          <p>Add a website or a landing page, or bring in the spreadsheet you already keep.</p>
          <div className="webops-empty-actions">
            <button type="button" className="btn" onClick={openNew}>
              Add project
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setImporter(true)}>
              Import from spreadsheet
            </button>
          </div>
        </section>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="webops-empty-inline">Nothing open here. Try another owner, or check Launched and paused below.</p>
          ) : (
            <div className="webops-sheet">
              <div className="webops-head" aria-hidden="true">
                <span>Project</span>
                <span>Stage</span>
                <span>Owner</span>
                <span>Due</span>
                <span>Next step</span>
                <span />
              </div>
              {stages.map((stage) => {
                const rows = active.filter((project) => project.stage === stage.key).sort(byDue);
                if (!rows.length) return null;
                return (
                  <section key={stage.key} className="webops-group">
                    <h2>
                      {stage.label}
                      <span>{rows.length}</span>
                    </h2>
                    {rows.map((project) => (
                      <ProjectRow key={project.id} project={project} today={today} onOpen={openProject} />
                    ))}
                  </section>
                );
              })}
            </div>
          )}

          <section className="webops-quiet">
            <button type="button" className="webops-quiet-toggle" aria-expanded={quietOpen} onClick={() => setQuietOpen((open) => !open)}>
              {quietOpen ? "Hide" : "Show"} launched and paused
              <span>{quiet.length}</span>
            </button>
            {quietOpen && quiet.length === 0 ? <p className="webops-empty-inline">None yet.</p> : null}
            {quietOpen && quiet.length > 0 ? (
              <div className="webops-sheet">
                {quiet.sort(byDue).map((project) => (
                  <ProjectRow key={project.id} project={project} today={today} onOpen={openProject} />
                ))}
              </div>
            ) : null}
          </section>

          <button type="button" className="webops-text-btn" onClick={() => setImporter(true)}>
            Import a spreadsheet
          </button>
        </>
      )}

      {editor ? (
        <Editor
          editor={editor}
          clients={data?.clients || []}
          busy={busy}
          nameRef={nameRef}
          onChange={(draft) => setEditor({ ...editor, draft, error: "" })}
          onMore={() => setEditor({ ...editor, more: !editor.more })}
          onActions={() => setEditor({ ...editor, actions: !editor.actions })}
          onClose={() => setEditor(null)}
          onSave={() => void saveEditor()}
          onStatus={(disposition) => void saveEditor({ disposition })}
          onDelete={() => void removeProject()}
        />
      ) : null}
      {importer ? (
        <ImportDialog
          onClose={() => setImporter(false)}
          onDone={() => {
            setImporter(false);
            void load();
            setNotice("Imported");
          }}
        />
      ) : null}
    </main>
  );
}

function ProjectRow({
  project,
  today,
  onOpen,
}: {
  project: WebsiteProject;
  today: string;
  onOpen: (project: WebsiteProject) => void;
}) {
  const mark = signal(project, today);
  const owners = ownerNames(project.owners);
  const client = project.clientName && project.clientName !== project.name ? project.clientName : "";
  return (
    <div
      className="webops-line"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(project);
        }
      }}
    >
      <span className="webops-project">
        {mark ? <span className={`webops-dot is-${mark}`} title={mark === "overdue" ? "Overdue" : "Waiting on the client"} /> : <span className="webops-dot" />}
        <span>
          <strong>{project.name}</strong>
          {client ? <em>{client}</em> : null}
        </span>
      </span>
      <span className="webops-cell">{stageLabel(project.board, project.stage)}</span>
      <span className="webops-cell">{owners.length ? owners.join(", ") : "No owner"}</span>
      <span className="webops-cell">
        {project.targetOn ? formatDeskDate(project.targetOn) : "—"}
        {mark === "overdue" ? <i className="is-overdue">Overdue</i> : null}
        {mark === "waiting" ? <i className="is-waiting">Waiting</i> : null}
      </span>
      <span className="webops-cell webops-next">{project.nextStep || "—"}</span>
      {project.basecampUrl ? (
        <a
          className="webops-bc"
          href={project.basecampUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Basecamp for ${project.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <BasecampIcon />
        </a>
      ) : (
        <span />
      )}
    </div>
  );
}

function BasecampIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        d="M14 5h5v5M19 5l-8 8M10 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4"
      />
    </svg>
  );
}

function Editor({
  editor,
  clients,
  busy,
  nameRef,
  onChange,
  onMore,
  onActions,
  onClose,
  onSave,
  onStatus,
  onDelete,
}: {
  editor: EditorState;
  clients: ClientOption[];
  busy: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  onChange: (draft: WebsiteDraft) => void;
  onMore: () => void;
  onActions: () => void;
  onClose: () => void;
  onSave: () => void;
  onStatus: (disposition: WebsiteDraft["disposition"]) => void;
  onDelete: () => void;
}) {
  const draft = editor.draft;
  function set<K extends keyof WebsiteDraft>(key: K, value: WebsiteDraft[K]) {
    onChange({ ...draft, [key]: value });
  }
  function toggleOwner(name: string) {
    const names = ownerNames(draft.owners);
    const has = names.some((part) => part.toLowerCase() === name.toLowerCase());
    const next = has ? names.filter((part) => part.toLowerCase() !== name.toLowerCase()) : [...names, name];
    set("owners", joinPeople(next));
  }

  return (
    <div className="webops-panel-back" onMouseDown={onClose}>
      <form
        className="webops-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webops-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="webops-panel-head">
          <h2 id="webops-editor-title">{editor.id ? "Edit project" : "Add project"}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="webops-panel-body">
          <label className="field">
            <span>Name</span>
            <input ref={nameRef} value={draft.name} onChange={(event) => set("name", event.target.value)} required />
          </label>
          <label className="field">
            <span>Stage</span>
            <select value={draft.stage} onChange={(event) => set("stage", event.target.value)}>
              {stagesFor(draft.board).map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="webops-owners">
            <legend>Owner</legend>
            {WEBSITE_OWNER_CHIPS.map((name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={ownerNames(draft.owners).some((part) => part.toLowerCase() === name.toLowerCase())}
                  onChange={() => toggleOwner(name)}
                />
                {name}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Due</span>
            <input type="date" value={draft.targetOn} onChange={(event) => set("targetOn", event.target.value)} />
          </label>
          <label className="field">
            <span>Next step</span>
            <textarea rows={3} value={draft.nextStep} onChange={(event) => set("nextStep", event.target.value)} />
          </label>
          <label className="field">
            <span>Waiting on</span>
            <input
              value={draft.waitingOn}
              onChange={(event) => set("waitingOn", event.target.value)}
              placeholder="Client name, or a teammate"
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea rows={3} value={draft.blockers} onChange={(event) => set("blockers", event.target.value)} />
          </label>
          <label className="field">
            <span>Basecamp link</span>
            <input value={draft.basecampUrl} onChange={(event) => set("basecampUrl", event.target.value)} placeholder="https://" />
          </label>
          <button type="button" className="webops-text-btn" onClick={onMore} aria-expanded={editor.more}>
            {editor.more ? "Hide details" : "More details"}
          </button>
          {editor.more ? (
            <div className="webops-more">
              <label className="field">
                <span>Campaign Desk client</span>
                <select
                  value={draft.clientId || ""}
                  onChange={(event) => {
                    const id = event.target.value;
                    const client = clients.find((item) => item.id === id);
                    onChange({ ...draft, clientId: id || null, clientName: client ? client.name : draft.clientName });
                  }}
                >
                  <option value="">No client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Platform</span>
                <input value={draft.platform} onChange={(event) => set("platform", event.target.value)} />
              </label>
              {draft.board === "website" ? (
                <label className="field">
                  <span>Kind</span>
                  <select
                    value={draft.projectGroup === "custom" ? "custom" : "web"}
                    onChange={(event) => set("projectGroup", event.target.value === "custom" ? "custom" : "web")}
                  >
                    <option value="web">Web</option>
                    <option value="custom">Internal or custom</option>
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          {editor.error ? (
            <p className="error" role="alert">
              {editor.error}
            </p>
          ) : null}
          {editor.id ? (
            <div className="webops-actions">
              <button type="button" className="webops-text-btn" onClick={onActions} aria-expanded={editor.actions}>
                More actions
              </button>
              {editor.actions ? (
                <div className="webops-action-row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStatus("launched")}>
                    Launched
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStatus("paused")}>
                    Paused
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStatus("non_responsive")}>
                    Not responding
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStatus("archived")}>
                    Archive
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="webops-panel-foot">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [fileAs, setFileAs] = useState<"auto" | "non_responsive">("auto");
  const [preview, setPreview] = useState<{
    rows: Array<{ draft: WebsiteDraft; warning: string }>;
    errors: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(commit: boolean) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/website/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, fileAs, commit }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Couldn't read that file.");
      return;
    }
    setPreview(body);
    if (commit) onDone();
  }

  return (
    <div className="webops-panel-back" onMouseDown={onClose}>
      <div className="webops-panel" role="dialog" aria-modal="true" aria-labelledby="webops-import-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="webops-panel-head">
          <h2 id="webops-import-title">Import a spreadsheet</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="webops-panel-body">
          <p className="webops-hint">Paste a CSV. Nothing is added until you confirm. This does not change the Google Sheet.</p>
          <label className="field">
            <span>CSV</span>
            <textarea rows={8} value={csv} onChange={(event) => setCsv(event.target.value)} />
          </label>
          <label className="field">
            <span>File</span>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) setCsv(await file.text());
              }}
            />
          </label>
          <label className="field">
            <span>File these as</span>
            <select value={fileAs} onChange={(event) => setFileAs(event.target.value === "non_responsive" ? "non_responsive" : "auto")}>
              <option value="auto">Keep the status from the file</option>
              <option value="non_responsive">Not responding</option>
            </select>
          </label>
          {error ? <p className="error">{error}</p> : null}
          {preview ? (
            <p className="webops-hint">
              {preview.rows.length} ready
              {preview.errors[0] ? ` · ${preview.errors[0]}` : ""}
            </p>
          ) : null}
        </div>
        <div className="webops-panel-foot">
          <button type="button" className="btn btn-secondary" disabled={busy || !csv.trim()} onClick={() => void run(false)}>
            Preview
          </button>
          <button type="button" className="btn" disabled={busy || !preview || preview.rows.length === 0} onClick={() => void run(true)}>
            Add {preview?.rows.length || 0}
          </button>
        </div>
      </div>
    </div>
  );
}
