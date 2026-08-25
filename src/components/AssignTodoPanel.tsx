"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type Person = { slug: string; label: string };
type Project = {
  id: string;
  name: string;
  basecampProjectId: string;
  internal: boolean;
};
type Warning = { hasRoom: boolean; headline: string; detail: string };

function ProjectCombobox({
  projects,
  value,
  onPick,
}: {
  projects: Project[];
  value: string;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = projects.find((p) => p.id === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    const starts: Project[] = [];
    const contains: Project[] = [];
    for (const p of projects) {
      const n = p.name.toLowerCase();
      if (n.startsWith(q)) starts.push(p);
      else if (n.includes(q)) contains.push(p);
    }
    return [...starts, ...contains];
  }, [projects, query]);

  useEffect(() => {
    setActive((a) => (a >= matches.length ? 0 : a));
  }, [matches.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(p: Project) {
    onPick(p.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(matches.length - 1, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const hit = matches[active];
      if (hit) choose(hit);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="fc-combo" ref={wrapRef}>
      <input
        value={open ? query : selected?.name || ""}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={selected ? selected.name : "Type a client or project"}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Project"
        autoComplete="off"
      />
      {open ? (
        <ul className="fc-combo-list" id={listId} role="listbox">
          {matches.length === 0 ? (
            <li className="fc-combo-empty">No matches</li>
          ) : (
            matches.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  className={`fc-combo-item ${i === active ? "is-active" : ""} ${
                    p.id === value ? "is-picked" : ""
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(p);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {p.name}
                  {p.internal ? <span className="fc-combo-tag">internal</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function AssignTodoPanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [hours, setHours] = useState("1");
  const [assignee, setAssignee] = useState("");
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [warning, setWarning] = useState<Warning | null>(null);
  const [checking, setChecking] = useState(false);
  const [posting, setPosting] = useState(false);
  const [done, setDone] = useState<{ todoUrl: string; assigneeName: string } | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/assign");
        if (!res.ok) {
          if (on) setLoadError("Could not load projects.");
          return;
        }
        const data = await res.json();
        if (!on) return;
        setPeople(data.people || []);
        setProjects(data.projects || []);
      } catch {
        if (on) setLoadError("Could not load projects.");
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  const project = projects.find((p) => p.id === projectId);

  async function openWarning(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setDone(null);
    if (!project) {
      setFormError("Pick a project.");
      return;
    }
    if (!title.trim()) {
      setFormError("Add a title.");
      return;
    }
    if (!dueOn) {
      setFormError("Pick a due date.");
      return;
    }
    if (!assignee) {
      setFormError("Pick an assignee.");
      return;
    }
    setChecking(true);
    try {
      const params = new URLSearchParams({
        assignee,
        due: dueOn,
        hours: hours.trim() || "1",
      });
      const res = await fetch(`/api/admin/assign/load?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || "Could not check their forecast.");
        return;
      }
      setWarning(data.warning);
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  function cancelWarning() {
    setWarning(null);
  }

  async function proceed() {
    if (!project || posting) return;
    setPosting(true);
    setFormError("");
    try {
      const res = await fetch("/api/admin/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          dueOn,
          assignee,
          basecampProjectId: project.basecampProjectId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWarning(null);
        setFormError(data.error || "Could not create the to-do.");
        return;
      }
      setWarning(null);
      setDone({
        todoUrl: data.todoUrl || "",
        assigneeName: data.assigneeName || "",
      });
      setTitle("");
    } catch {
      setWarning(null);
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="ops-panel assign-panel">
      <div className="ops-panel-head">
        <h2>Assign a Basecamp to-do</h2>
      </div>
      <form className="assign-form" onSubmit={openWarning}>
        {loadError ? <p className="error">{loadError}</p> : null}
        {formError ? <p className="error">{formError}</p> : null}
        {done ? (
          <p className="assign-done">
            Assigned{done.assigneeName ? ` to ${done.assigneeName}` : ""}.
            {done.todoUrl ? (
              <>
                {" "}
                <a href={done.todoUrl} target="_blank" rel="noreferrer">
                  Open in Basecamp
                </a>
              </>
            ) : null}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="assign-project">Project</label>
          <ProjectCombobox
            projects={projects}
            value={projectId}
            onPick={setProjectId}
          />
        </div>
        <div className="field">
          <label htmlFor="assign-title">Title</label>
          <input
            id="assign-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing"
          />
        </div>
        <div className="assign-form-row">
          <div className="field">
            <label htmlFor="assign-due">Due</label>
            <input
              id="assign-due"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </div>
          <div className="field assign-hours">
            <label htmlFor="assign-hours">Hours</label>
            <input
              id="assign-hours"
              type="number"
              min="0"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="assign-person">Assignee</label>
            <select
              id="assign-person"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Pick someone</option>
              {people.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit" disabled={checking}>
            {checking ? "Checking…" : "Assign"}
          </button>
        </div>
      </form>

      {warning ? (
        <div className="modal-backdrop" onClick={cancelWarning}>
          <div
            className="modal card card-pad stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-warn-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="assign-warn-title" className="assign-warn-title">
              {warning.hasRoom ? "They have room" : "Not enough open time"}
            </h2>
            <p className="assign-warn-copy">{warning.headline}</p>
            {warning.detail ? <p className="muted">{warning.detail}</p> : null}
            <div className="row">
              <button className="btn btn-secondary" type="button" onClick={cancelWarning}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void proceed()} disabled={posting}>
                {posting ? "Assigning…" : "Proceed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
