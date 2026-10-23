"use client";

import { useEffect, useRef, useState } from "react";

export type BasecampProjectChoice = { id: string; name: string };

export type BasecampLinkState = {
  loading: boolean;
  error: string;
  projects: BasecampProjectChoice[];
  missingIds: string[];
};

export function BasecampProjectSelect({
  projects,
  busy,
  disabled,
  label,
  onPick,
}: {
  projects: BasecampProjectChoice[];
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPick: (projectId: string) => void;
}) {
  return (
    <select
      className="fc-bc-link-select"
      aria-label={label}
      value=""
      disabled={disabled || busy || projects.length === 0}
      onChange={(e) => {
        const id = e.target.value;
        if (id) onPick(id);
      }}
    >
      <option value="">{busy ? "Linking…" : "Link a Basecamp project"}</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  );
}

type MissingClient = { id: string; name: string };

/**
 * Admin-only list of real clients that still have no Basecamp project, with one
 * control to attach one. This stays off Forecast. Confident name matches are
 * filled in when the section mounts. A client created later shows up the next
 * time an admin opens it.
 */
export function MissingBasecampProjects({
  refreshToken = 0,
  onLinked,
  onReady,
}: {
  refreshToken?: number;
  onLinked?: (clientId: string) => void;
  onReady?: (state: BasecampLinkState) => void;
}) {
  const [missing, setMissing] = useState<MissingClient[] | null>(null);
  const [projects, setProjects] = useState<BasecampProjectChoice[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [note, setNote] = useState("");
  const [linkingId, setLinkingId] = useState("");
  const [hidden, setHidden] = useState(false);
  const onReadyRef = useRef(onReady);
  const onLinkedRef = useRef(onLinked);
  onReadyRef.current = onReady;
  onLinkedRef.current = onLinked;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      const listed = await fetch("/api/admin/basecamp-client-links");
      if (cancelled) return;
      if (listed.status === 401) {
        setHidden(true);
        setMissing([]);
        setLoading(false);
        return;
      }
      const listJson = await listed.json().catch(() => null);
      if (!listed.ok || !listJson) {
        setLoading(false);
        setError("Couldn't load clients that are missing a Basecamp project.");
        setMissing([]);
        return;
      }
      let nextMissing: MissingClient[] = Array.isArray(listJson.missing) ? listJson.missing : [];
      let nextProjects = projects;
      let nextError = "";
      let nextNote = "";
      if (nextMissing.length) {
        const matched = await fetch("/api/admin/basecamp-client-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "match", lazy: true }),
        });
        if (cancelled) return;
        const matchJson = await matched.json().catch(() => null);
        if (matchJson) {
          if (Array.isArray(matchJson.missing)) nextMissing = matchJson.missing;
          if (Array.isArray(matchJson.projects) && matchJson.projects.length) {
            nextProjects = matchJson.projects;
          }
          if (matchJson.ok === false && matchJson.error) nextError = String(matchJson.error);
          const linked = Array.isArray(matchJson.linked) ? matchJson.linked.length : 0;
          if (linked) {
            nextNote = `Linked ${linked} ${linked === 1 ? "client" : "clients"} by name.`;
          }
          for (const row of matchJson.linked || []) {
            if (row?.clientId) onLinkedRef.current?.(String(row.clientId));
          }
        } else if (!matched.ok) {
          nextError = "Couldn't reach Basecamp to match projects.";
        }
      }
      if (cancelled) return;
      setMissing(nextMissing);
      setProjects(nextProjects);
      setError(nextError);
      setNote(nextNote);
      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
    // `projects` is intentionally omitted: this effect refreshes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    onReadyRef.current?.({
      loading: loading || missing === null,
      error,
      projects,
      missingIds: (missing || []).map((client) => client.id),
    });
  }, [loading, error, projects, missing]);

  async function matchNow() {
    setMatching(true);
    setError("");
    const res = await fetch("/api/admin/basecamp-client-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "match", force: true }),
    });
    const json = await res.json().catch(() => null);
    setMatching(false);
    if (!json) {
      setError("Couldn't reach Basecamp to match projects.");
      return;
    }
    if (Array.isArray(json.missing)) setMissing(json.missing);
    if (Array.isArray(json.projects) && json.projects.length) setProjects(json.projects);
    if (json.ok === false) {
      setError(json.error || "Couldn't match Basecamp projects.");
      return;
    }
    const linked = Array.isArray(json.linked) ? json.linked.length : 0;
    const left = Array.isArray(json.missing) ? json.missing.length : 0;
    setNote(
      linked
        ? `Linked ${linked} ${linked === 1 ? "client" : "clients"} by name.`
        : left
          ? "No confident name matches. Pick the project for each client below."
          : "Every Forecast client has a Basecamp project."
    );
    for (const row of json.linked || []) {
      if (row?.clientId) onLinkedRef.current?.(String(row.clientId));
    }
  }

  async function pick(clientId: string, projectId: string) {
    setLinkingId(clientId);
    setError("");
    const res = await fetch("/api/admin/basecamp-client-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", clientId, projectId }),
    });
    const json = await res.json().catch(() => null);
    setLinkingId("");
    if (!res.ok || json?.ok === false) {
      setError(json?.error || "Couldn't save that Basecamp project.");
      return;
    }
    const nextMissing = Array.isArray(json.missing)
      ? (json.missing as MissingClient[])
      : (missing || []).filter((client) => client.id !== clientId);
    setMissing(nextMissing);
    onLinkedRef.current?.(clientId);
  }

  if (hidden || missing === null) return null;
  if (!missing.length && !note && !error) return null;

  return (
    <section className="fc-bc-missing" aria-label="Clients missing a Basecamp project">
      {missing.length ? (
        <div className="fc-bc-missing-head">
          <strong>
            {missing.length} {missing.length === 1 ? "client has" : "clients have"} no Basecamp
            project
          </strong>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void matchNow()}
            disabled={matching || loading}
          >
            {matching ? "Matching…" : "Match by name"}
          </button>
        </div>
      ) : null}
      {note ? <p className="muted">{note}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {missing.length ? (
        <ul className="fc-bc-missing-list">
          {missing.map((client) => (
            <li key={client.id}>
              <span>{client.name}</span>
              {projects.length ? (
                <BasecampProjectSelect
                  projects={projects}
                  busy={linkingId === client.id}
                  label={`Basecamp project for ${client.name}`}
                  onPick={(projectId) => void pick(client.id, projectId)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Forecast loads this and renders nothing. The request fills confident links
 * in the background and does not wait on the page.
 */
export function SilentBasecampClientMatch({
  onLinked,
}: {
  onLinked?: (clientIds: string[]) => void;
}) {
  const onLinkedRef = useRef(onLinked);
  onLinkedRef.current = onLinked;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/basecamp-client-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "match", silent: true }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const ids = Array.isArray(json.linked)
          ? json.linked.map((row: { clientId?: string }) => row?.clientId).filter(Boolean)
          : [];
        if (ids.length) onLinkedRef.current?.(ids.map(String));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
