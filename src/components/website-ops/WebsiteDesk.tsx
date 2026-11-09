"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  WEBSITE_OWNER_CHIPS,
  blankDraft,
  boardColumn,
  compareProjects,
  defaultStage,
  deskToday,
  formatDeskDate,
  inWeekLane,
  isActive,
  isOverdue,
  isWaiting,
  matchesPerson,
  ownerNames,
  overduePhrase,
  todayColumn,
  onBoard,
  projectToDraft,
  splitPeople,
  stagesFor,
  waitingBreakdown,
  waitingKind,
  waitingPhrase,
  weekLabel as formatWeek,
  joinPeople,
  type WebsiteBoard,
  type WebsiteBucket,
  type WebsiteDraft,
  type WebsitePriority,
  type WebsiteProject,
} from "@/lib/website-ops-model";

type ClientOption = { id: string; name: string };

type DeskData = {
  today: string;
  weekLabel: string;
  projects: WebsiteProject[];
  clients: ClientOption[];
  meName: string | null;
  owners: string[];
};

type EditorState = {
  id: string | null;
  draft: WebsiteDraft;
  more: boolean;
  error: string;
};

type View = "week" | "list" | "board";

const EMPTY_PROJECTS: WebsiteProject[] = [];

const LANES = ["overdue", "week", "waiting", "rest"] as const;
type Lane = (typeof LANES)[number];

function haystack(project: WebsiteProject): string {
  return [
    project.name,
    project.clientName,
    project.owners,
    project.waitingOn,
    project.nextStep,
    project.blockers,
    project.platform,
  ]
    .join("\n")
    .toLowerCase();
}

function toggleName(current: string, name: string): string {
  const parts = splitPeople(current);
  const has = parts.some((part) => part.toLowerCase() === name.toLowerCase());
  const next = has
    ? parts.filter((part) => part.toLowerCase() !== name.toLowerCase())
    : [...parts, name];
  return joinPeople(next);
}

function laneTitle(lane: Lane, person: string, meName: string | null): string {
  if (lane === "overdue") return "Overdue";
  if (lane === "week") return "Due this week";
  if (lane === "waiting") return "Waiting";
  if (person && person === meName) return "Also on you";
  if (person && person !== "__none") return `Also on ${person}`;
  return "Everything else";
}

function emptyLane(lane: Lane, who: string): string {
  if (!who) {
    if (lane === "overdue") return "Nothing is overdue.";
    if (lane === "week") return "Nothing else is due this week.";
    if (lane === "waiting") return "Nobody is waiting on a person.";
    return "Nothing else is open.";
  }
  const name = who === "you" ? "you" : who;
  if (lane === "overdue") return who === "you" ? "Nothing of yours is overdue." : `Nothing for ${name} is overdue.`;
  if (lane === "week") return "Nothing else is due this week.";
  if (lane === "waiting") return who === "you" ? "You're not waiting on anyone." : `${name} isn't waiting on anyone.`;
  return who === "you" ? "Nothing else is on you." : `Nothing else is on ${name}.`;
}

export function WebsiteDesk() {
  const [data, setData] = useState<DeskData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [view, setView] = useState<View>("week");
  const [boardKind, setBoardKind] = useState<WebsiteBoard>("website");
  const [listBucket, setListBucket] = useState<WebsiteBucket>("");
  const [listBoard, setListBoard] = useState<"" | WebsiteBoard>("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [importer, setImporter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeLane, setActiveLane] = useState<Lane | "">("");
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
    setPerson((current) => (current === null ? body.meName || "" : current));
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
  const meName = data?.meName || null;
  const selected = person || "";

  const scoped = useMemo(
    () => projects.filter((project) => matchesPerson(project, selected)),
    [projects, selected]
  );

  const lanes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pass = (project: WebsiteProject) => !q || haystack(project).includes(q);
    const pool = scoped.filter(pass);
    const byDue = (a: WebsiteProject, b: WebsiteProject) =>
      (a.targetOn || "9999").localeCompare(b.targetOn || "9999") || compareProjects(a, b);
    const inColumn = (project: WebsiteProject, lane: Lane) => todayColumn(project, today) === lane;
    return {
      overdue: pool.filter((project) => inColumn(project, "overdue")).sort(byDue),
      waiting: pool
        .filter((project) => inColumn(project, "waiting"))
        .sort((a, b) => {
          const client = Number(waitingKind(b.waitingOn) === "client") - Number(waitingKind(a.waitingOn) === "client");
          return client || compareProjects(a, b);
        }),
      week: pool.filter((project) => inColumn(project, "week")).sort(byDue),
      rest: pool.filter((project) => inColumn(project, "rest")).sort(compareProjects),
    };
  }, [scoped, query, today]);

  const teamLanes = useMemo(() => {
    const count = (lane: Lane) => projects.filter((project) => todayColumn(project, today) === lane).length;
    return { overdue: count("overdue"), week: count("week"), waiting: count("waiting"), rest: count("rest") };
  }, [projects, today]);

  const yoursLanes = useMemo(() => {
    if (!meName) return null;
    const mineProjects = projects.filter((project) => matchesPerson(project, meName));
    const count = (lane: Lane) => mineProjects.filter((project) => todayColumn(project, today) === lane).length;
    return { overdue: count("overdue"), week: count("week"), waiting: count("waiting"), rest: count("rest") };
  }, [projects, meName, today]);

  const unassigned = projects.filter(
    (project) => isActive(project) && ownerNames(project.owners).length === 0
  ).length;

  function replaceProject(project: WebsiteProject) {
    setData((current) =>
      current
        ? { ...current, projects: current.projects.map((item) => (item.id === project.id ? project : item)) }
        : current
    );
  }

  async function move(project: WebsiteProject, stage: string) {
    if (stage === project.stage) return;
    const res = await fetch(`/api/website/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(body.error || "Couldn't move that.");
      return;
    }
    replaceProject(body.project);
    setNotice("Saved");
  }

  function openNew() {
    const draft = blankDraft(view === "board" ? boardKind : "website");
    if (meName) draft.owners = meName;
    setEditor({ id: null, draft, more: false, error: "" });
  }

  function openProject(project: WebsiteProject) {
    const draft = projectToDraft(project);
    setEditor({ id: project.id, draft, more: false, error: "" });
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
    if (!window.confirm("Delete this project? This can't be undone.")) return;
    setBusy(true);
    const res = await fetch(`/api/website/${editor.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setEditor({ ...editor, error: "Couldn't delete that." });
      return;
    }
    setData((current) =>
      current ? { ...current, projects: current.projects.filter((item) => item.id !== editor.id) } : current
    );
    setEditor(null);
    setNotice("Deleted");
  }

  function jump(lane: Lane) {
    setView("week");
    setActiveLane(lane);
    document.getElementById(`lane-${lane}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const looking =
    selected === ""
      ? "Whole team"
      : selected === "__none"
        ? "No owner"
        : selected === meName
          ? "Your projects"
          : `${selected}'s projects`;

  return (
    <main className="container container-wide webops">
      <header className="webops-top">
        <div>
          <h1>{view === "list" ? "All projects" : view === "board" ? "Board" : "This week"}</h1>
          <p className="webops-sub">
            {data?.weekLabel || formatWeek(today)}
            <span aria-hidden="true"> · </span>
            {looking}
          </p>
        </div>
        <div className="webops-top-actions">
          <div className="webops-views" role="tablist" aria-label="Views">
            {(
              [
                ["week", "This week"],
                ["list", "All projects"],
                ["board", "Board"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                className="webops-view"
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={openNew}>
            Add project
          </button>
        </div>
      </header>

      <div className="webops-toolbar">
      <div className="webops-people" role="toolbar" aria-label="Whose work">
        {meName ? (
          <button
            type="button"
            className="webops-person"
            aria-pressed={selected === meName}
            onClick={() => setPerson(meName)}
          >
            {meName}
            <span className="webops-you">You</span>
          </button>
        ) : null}
        <button
          type="button"
          className="webops-person"
          aria-pressed={selected === ""}
          onClick={() => setPerson("")}
        >
          Everyone
        </button>
        {WEBSITE_OWNER_CHIPS.filter((name) => name !== meName).map((name) => (
          <button
            key={name}
            type="button"
            className="webops-person"
            aria-pressed={selected === name}
            onClick={() => setPerson(name)}
          >
            {name}
          </button>
        ))}
        {unassigned > 0 ? (
          <button
            type="button"
            className="webops-person"
            aria-pressed={selected === "__none"}
            onClick={() => setPerson("__none")}
          >
            No owner
            <span className="webops-you">{unassigned}</span>
          </button>
        ) : null}
      </div>
      <label className="webops-search">
        <span className="sr-only">Search</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, client, or note"
          type="search"
        />
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
          <p>
            Add the first website or landing page, or bring in a spreadsheet. Overdue work, this week, and anything waiting will show up here.
          </p>
          <div className="webops-empty-actions">
            <button type="button" className="btn" onClick={openNew}>
              Add project
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setImporter(true)}>
              Import from spreadsheet
            </button>
          </div>
        </section>
      ) : view === "week" ? (
        <WeekView
          lanes={lanes}
          team={teamLanes}
          yours={yoursLanes}
          selected={selected}
          meName={meName}
          who={selected === meName ? "you" : selected && selected !== "__none" ? selected : ""}
          today={today}
          activeLane={activeLane}
          onJump={jump}
          onOpen={openProject}
          onMove={move}
          paused={scoped.filter((project) => project.disposition === "paused").length}
          launched={scoped.filter((project) => project.disposition === "launched").length}
          quiet={scoped.filter((project) => project.disposition === "non_responsive").length}
          onList={(bucket) => {
            setListBucket(bucket);
            setView("list");
          }}
        />
      ) : view === "list" ? (
        <ListView
          projects={projects}
          selected={selected}
          today={today}
          query={query}
          bucket={listBucket}
          board={listBoard}
          onBucket={setListBucket}
          onBoard={setListBoard}
          onOpen={openProject}
          onMove={move}
          onImport={() => setImporter(true)}
        />
      ) : (
        <BoardView
          projects={projects}
          selected={selected}
          kind={boardKind}
          query={query}
          today={today}
          onKind={setBoardKind}
          onOpen={openProject}
          onMove={move}
        />
      )}

      {editor ? (
        <Editor
          editor={editor}
          clients={data?.clients || []}
          busy={busy}
          today={today}
          nameRef={nameRef}
          onChange={(draft) => setEditor({ ...editor, draft, error: "" })}
          onMore={() => setEditor({ ...editor, more: !editor.more })}
          onClose={() => setEditor(null)}
          onSave={() => void saveEditor()}
          onStatus={(disposition) => void saveEditor({ disposition })}
          onDelete={() => void removeProject()}
          onTouch={() =>
            setEditor({
              ...editor,
              draft: { ...editor.draft, lastTouchpoint: today },
              more: true,
            })
          }
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

function countHint(
  lane: Lane,
  visible: number,
  team: number,
  yours: number | null,
  filtered: boolean,
  waitingClient: number,
  waitingTeam: number
): string {
  if (lane === "waiting") {
    if (visible === 0) return filtered && team ? `${team} on the team` : "All clear";
    const bits: string[] = [];
    if (waitingClient) bits.push(`${waitingClient} on a client`);
    if (waitingTeam) bits.push(`${waitingTeam} on a teammate`);
    if (filtered && team !== visible) bits.push(`${team} on the team`);
    return bits.join(" · ");
  }
  if (lane === "week" && visible === 0) return "Nothing else due";
  if (lane === "rest") return filtered ? "Not due this week" : "Not due or waiting";
  if (filtered) {
    if (visible === team) return "That's the whole team";
    return `${team} on the team`;
  }
  if (yours === null) return "Whole team";
  if (yours === 0) return "None are yours";
  return yours === 1 ? "1 is yours" : `${yours} are yours`;
}

function WeekView({
  lanes,
  team,
  yours,
  selected,
  meName,
  who,
  today,
  activeLane,
  onJump,
  onOpen,
  onMove,
  paused,
  launched,
  quiet,
  onList,
}: {
  lanes: Record<Lane, WebsiteProject[]>;
  team: Record<Lane, number>;
  yours: Record<Lane, number> | null;
  selected: string;
  meName: string | null;
  who: string;
  today: string;
  activeLane: Lane | "";
  onJump: (lane: Lane) => void;
  onOpen: (project: WebsiteProject) => void;
  onMove: (project: WebsiteProject, stage: string) => void;
  paused: number;
  launched: number;
  quiet: number;
  onList: (bucket: WebsiteBucket) => void;
}) {
  const filtered = selected !== "";
  return (
    <>
      <div className="webops-counts">
        {LANES.map((lane) => {
          const wait = waitingBreakdown(lanes.waiting);
          const hint = countHint(
            lane,
            lanes[lane].length,
            team[lane],
            yours ? yours[lane] : null,
            filtered,
            wait.client,
            wait.team
          );
          return (
            <button
              key={lane}
              type="button"
              className={`webops-count is-${lane}${activeLane === lane ? " is-on" : ""}`}
              onClick={() => onJump(lane)}
            >
              <strong>{lanes[lane].length}</strong>
              <span>{laneTitle(lane, selected, meName)}</span>
              <small>{hint}</small>
            </button>
          );
        })}
      </div>
      <div className="webops-lanes">
        {LANES.map((lane) => (
          <section
            key={lane}
            id={`lane-${lane}`}
            className={`webops-lane${activeLane === lane ? " is-on" : ""}`}
            aria-label={laneTitle(lane, selected, meName)}
          >
            <h2>{laneTitle(lane, selected, meName)}</h2>
            {lanes[lane].length === 0 ? (
              <p className="webops-lane-empty">{emptyLane(lane, who)}</p>
            ) : (
              lanes[lane].map((project) => (
                <ProjectCard key={`${lane}-${project.id}`} project={project} today={today} onOpen={onOpen} onMove={onMove} />
              ))
            )}
          </section>
        ))}
      </div>
      <p className="webops-foot">
        <button type="button" onClick={() => onList("launched")}>
          {launched} launched
        </button>
        <button type="button" onClick={() => onList("paused")}>
          {paused} paused
        </button>
        <button type="button" onClick={() => onList("non_responsive")}>
          {quiet} not responding
        </button>
      </p>
    </>
  );
}

function ProjectCard({
  project,
  today,
  onOpen,
  onMove,
}: {
  project: WebsiteProject;
  today: string;
  onOpen: (project: WebsiteProject) => void;
  onMove: (project: WebsiteProject, stage: string) => void;
}) {
  const launched = project.disposition === "launched" && project.launchOn;
  const late = isOverdue(project, today);
  const dateLabel = launched
    ? `Launched ${formatDeskDate(project.launchOn)}`
    : project.targetOn
      ? formatDeskDate(project.targetOn)
      : "No date";
  const lateNote = late ? overduePhrase(project.targetOn, today) : "";
  return (
    <article className="webops-card">
      <div className="webops-card-top">
        <button type="button" className="webops-card-name" onClick={() => onOpen(project)}>
          {project.name}
        </button>
        {project.priority === "high" ? <span className="webops-pill webops-pill-high">High</span> : null}
        {project.disposition === "paused" ? <span className="webops-pill">Paused</span> : null}
      </div>
      <div className="webops-card-meta">
        <span>{kindLabel(project)}</span>
        <StageSelect project={project} onMove={onMove} />
        <span className={late ? "is-late" : ""}>
          {late ? `Due ${dateLabel}` : dateLabel}
          {lateNote ? <span className="webops-ago"> · {lateNote}</span> : null}
        </span>
      </div>
      <OwnerLine owners={project.owners} />
      {project.waitingOn ? <p className="webops-wait">{waitingPhrase(project.waitingOn)}</p> : null}
      {project.nextStep ? <p className="webops-next">{project.nextStep}</p> : null}
      {project.basecampUrl ? (
        <a href={project.basecampUrl} target="_blank" rel="noreferrer">
          Basecamp
        </a>
      ) : null}
    </article>
  );
}

function StageSelect({
  project,
  onMove,
}: {
  project: WebsiteProject;
  onMove: (project: WebsiteProject, stage: string) => void;
}) {
  return (
    <select
      className="webops-stage"
      aria-label={`Stage for ${project.name}`}
      value={stagesFor(project.board).some((stage) => stage.key === project.stage) ? project.stage : boardColumn(project)}
      onChange={(event) => onMove(project, event.target.value)}
    >
      {stagesFor(project.board).map((stage) => (
        <option key={stage.key} value={stage.key}>
          {stage.label}
        </option>
      ))}
    </select>
  );
}

function ListView({
  projects,
  selected,
  today,
  query,
  bucket,
  board,
  onBucket,
  onBoard,
  onOpen,
  onMove,
  onImport,
}: {
  projects: WebsiteProject[];
  selected: string;
  today: string;
  query: string;
  bucket: WebsiteBucket;
  board: "" | WebsiteBoard;
  onBucket: (bucket: WebsiteBucket) => void;
  onBoard: (board: "" | WebsiteBoard) => void;
  onOpen: (project: WebsiteProject) => void;
  onMove: (project: WebsiteProject, stage: string) => void;
  onImport: () => void;
}) {
  const buckets: Array<[WebsiteBucket, string]> = [
    ["", "Open"],
    ["overdue", "Overdue"],
    ["due", "Due this week"],
    ["waiting", "Waiting"],
    ["launched", "Launched"],
    ["paused", "Paused"],
    ["non_responsive", "Not responding"],
  ];
  const rows = projects
    .filter((project) => matchesPerson(project, selected))
    .filter((project) => (board ? project.board === board : true))
    .filter((project) => inListBucket(project, bucket, today))
    .filter((project) => !query.trim() || haystack(project).includes(query.trim().toLowerCase()))
    .sort(compareProjects);

  return (
    <section className="webops-list">
      <div className="webops-people" role="toolbar" aria-label="Filter">
        {buckets.map(([key, label]) => (
          <button key={label} type="button" className="webops-person" aria-pressed={bucket === key} onClick={() => onBucket(key)}>
            {label}
          </button>
        ))}
        <button type="button" className="webops-person" aria-pressed={board === ""} onClick={() => onBoard("")}>
          Both
        </button>
        <button type="button" className="webops-person" aria-pressed={board === "website"} onClick={() => onBoard("website")}>
          Websites
        </button>
        <button type="button" className="webops-person" aria-pressed={board === "landing"} onClick={() => onBoard("landing")}>
          Landing pages
        </button>
        <button type="button" className="webops-person" onClick={onImport}>
          Import a spreadsheet
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="webops-empty-inline">Nothing matches. Try Everyone, or clear the search.</p>
      ) : (
        <div className="webops-table">
          {rows.map((project) => (
            <article key={project.id} className="webops-row">
              <button type="button" className="webops-card-name" onClick={() => onOpen(project)}>
                {project.name}
              </button>
              <span className="webops-who">{kindLabel(project)}</span>
              <StageSelect project={project} onMove={onMove} />
              <span className={isOverdue(project, today) ? "is-late" : ""}>
                {project.targetOn ? formatDeskDate(project.targetOn) : "No date"}
                {isOverdue(project, today) ? ` · ${overduePhrase(project.targetOn, today)}` : ""}
              </span>
              <OwnerLine owners={project.owners} />
              <span className="webops-wait">{project.waitingOn ? waitingPhrase(project.waitingOn) : project.nextStep}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function inListBucket(project: WebsiteProject, bucket: WebsiteBucket, today: string): boolean {
  if (bucket === "") return project.disposition === "active" || project.disposition === "paused";
  if (bucket === "active") return isActive(project);
  if (bucket === "overdue") return isOverdue(project, today);
  if (bucket === "due") return inWeekLane(project, today);
  if (bucket === "waiting") return isWaiting(project);
  if (bucket === "launched") return project.disposition === "launched";
  if (bucket === "paused") return project.disposition === "paused";
  if (bucket === "non_responsive") return project.disposition === "non_responsive";
  return false;
}

function OwnerLine({ owners }: { owners: string }) {
  const names = ownerNames(owners);
  if (!names.length) return <p className="webops-who">No owner</p>;
  return (
    <p className="webops-who">
      {names.map((name) => (
        <span key={name} className="webops-owner">
          {name}
        </span>
      ))}
    </p>
  );
}

function BoardView({
  projects,
  selected,
  kind,
  query,
  today,
  onKind,
  onOpen,
  onMove,
}: {
  projects: WebsiteProject[];
  selected: string;
  kind: WebsiteBoard;
  query: string;
  today: string;
  onKind: (kind: WebsiteBoard) => void;
  onOpen: (project: WebsiteProject) => void;
  onMove: (project: WebsiteProject, stage: string) => void;
}) {
  const columns = stagesFor(kind);
  const scroller = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  const cards = projects.filter((project) => {
    if (project.board !== kind || !onBoard(project)) return false;
    if (!matchesPerson(project, selected)) return false;
    if (query.trim() && !haystack(project).includes(query.trim().toLowerCase())) return false;
    return true;
  });

  function measureBoard() {
    const el = scroller.current;
    if (!el) return;
    setCanScroll({
      left: el.scrollLeft > 12,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 12,
    });
  }

  useEffect(() => {
    measureBoard();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", measureBoard);
    window.addEventListener("resize", measureBoard);
    return () => {
      el.removeEventListener("scroll", measureBoard);
      window.removeEventListener("resize", measureBoard);
    };
  }, [kind, cards.length]);

  function nudge(direction: number) {
    scroller.current?.scrollBy({ left: direction * 360, behavior: "smooth" });
  }

  return (
    <section>
      <div className="webops-people" role="toolbar" aria-label="Board">
        <button type="button" className="webops-person" aria-pressed={kind === "website"} onClick={() => onKind("website")}>
          Websites
        </button>
        <button type="button" className="webops-person" aria-pressed={kind === "landing"} onClick={() => onKind("landing")}>
          Landing pages
        </button>
        <p className="webops-hint">Drag a card to another column, or change the stage menu. Empty stages stay narrow.</p>
      </div>
      <div className={`webops-board-wrap${canScroll.right ? " can-right" : ""}${canScroll.left ? " can-left" : ""}`}>
        {canScroll.left ? (
          <button type="button" className="webops-board-nav is-left" onClick={() => nudge(-1)}>
            Earlier stages
          </button>
        ) : null}
        {canScroll.right ? (
          <button type="button" className="webops-board-nav is-right" onClick={() => nudge(1)}>
            Later stages
          </button>
        ) : null}
        <div className="webops-board" ref={scroller}>
          {columns.map((column) => {
            const items = cards.filter((project) => boardColumn(project) === column.key);
            const empty = items.length === 0;
            return (
              <div
                key={column.key}
                className={`webops-column${empty ? " is-empty" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData("text/plain");
                  const project = cards.find((item) => item.id === id);
                  if (project) onMove(project, column.key);
                }}
              >
                <h2>
                  {column.label}
                  <span>{items.length}</span>
                </h2>
                {empty ? <p className="sr-only">Nothing in {column.label}.</p> : null}
                {items.map((project) => (
                  <div key={project.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", project.id)}>
                    <ProjectCard project={project} today={today} onOpen={onOpen} onMove={onMove} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Editor({
  editor,
  clients,
  busy,
  today,
  nameRef,
  onChange,
  onMore,
  onClose,
  onSave,
  onStatus,
  onDelete,
  onTouch,
}: {
  editor: EditorState;
  clients: ClientOption[];
  busy: boolean;
  today: string;
  nameRef: RefObject<HTMLInputElement | null>;
  onChange: (draft: WebsiteDraft) => void;
  onMore: () => void;
  onClose: () => void;
  onSave: () => void;
  onStatus: (disposition: WebsiteDraft["disposition"]) => void;
  onDelete: () => void;
  onTouch: () => void;
}) {
  const draft = editor.draft;
  function set<K extends keyof WebsiteDraft>(key: K, value: WebsiteDraft[K]) {
    onChange({ ...draft, [key]: value });
  }
  function setBoard(board: WebsiteBoard) {
    const stage = stagesFor(board).some((item) => item.key === draft.stage) ? draft.stage : defaultStage(board);
    onChange({
      ...draft,
      board,
      stage,
      projectGroup: board === "landing" ? "" : draft.projectGroup || "web",
    });
  }

  return (
    <div className="webops-modal-back" onMouseDown={onClose}>
      <form
        className="webops-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webops-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="webops-modal-head">
          <h2 id="webops-editor-title">{editor.id ? "Edit project" : "Add project"}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="webops-modal-body">
        <div className="webops-kind" role="group" aria-label="Project type">
          <button type="button" aria-pressed={draft.board === "website"} onClick={() => setBoard("website")}>
            Website
          </button>
          <button type="button" aria-pressed={draft.board === "landing"} onClick={() => setBoard("landing")}>
            Landing page
          </button>
        </div>
        <label className="field">
          <span>Name</span>
          <input ref={nameRef} value={draft.name} onChange={(event) => set("name", event.target.value)} required placeholder="Client and page" />
        </label>
        <div className="webops-form-grid">
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
          <label className="field">
            <span>Due</span>
            <input type="date" value={draft.targetOn} onChange={(event) => set("targetOn", event.target.value)} />
          </label>
        </div>
        <div className="field">
          <span>Priority</span>
          <div className="webops-kind" role="group" aria-label="Priority">
            {(["low", "medium", "high"] as WebsitePriority[]).map((priority) => (
              <button
                key={priority}
                type="button"
                aria-pressed={draft.priority === priority}
                onClick={() => set("priority", priority)}
              >
                {priority === "low" ? "Low" : priority === "high" ? "High" : "Medium"}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Who</span>
          <div className="webops-people">
            {WEBSITE_OWNER_CHIPS.map((name) => (
              <button
                key={name}
                type="button"
                className="webops-person"
                aria-pressed={ownerNames(draft.owners).some((part) => part.toLowerCase() === name.toLowerCase())}
                onClick={() => set("owners", joinPeople(ownerNames(toggleName(draft.owners, name))))}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Waiting on</span>
          <input
            value={draft.waitingOn}
            onChange={(event) => set("waitingOn", event.target.value)}
            placeholder="Client name, or a teammate"
          />
        </label>
        <div className="webops-people">
          {["Client", ...WEBSITE_OWNER_CHIPS].map((name) => (
            <button
              key={name}
              type="button"
              className="webops-person"
              aria-pressed={draft.waitingOn.trim().toLowerCase() === name.toLowerCase()}
              onClick={() => set("waitingOn", draft.waitingOn.trim().toLowerCase() === name.toLowerCase() ? "" : name)}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Next step</span>
          <textarea rows={2} value={draft.nextStep} onChange={(event) => set("nextStep", event.target.value)} placeholder="What happens next" />
        </label>
        {editor.error ? (
          <p className="error" role="alert">
            {editor.error}
          </p>
        ) : null}
        {editor.more ? (
          <div className="webops-more">
            <label className="field">
              <span>Campaign Desk client</span>
              <select
                value={draft.clientId || ""}
                onChange={(event) => {
                  const id = event.target.value;
                  const client = clients.find((item) => item.id === id);
                  onChange({
                    ...draft,
                    clientId: id || null,
                    clientName: client ? client.name : draft.clientName,
                  });
                }}
              >
                <option value="">No client — internal or custom</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Shown as</span>
              <input value={draft.clientName} onChange={(event) => set("clientName", event.target.value)} />
            </label>
            {draft.board === "website" ? (
              <div className="webops-kind" role="group" aria-label="Kind of work">
                <button type="button" aria-pressed={draft.projectGroup !== "custom"} onClick={() => set("projectGroup", "web")}>
                  Web
                </button>
                <button type="button" aria-pressed={draft.projectGroup === "custom"} onClick={() => set("projectGroup", "custom")}>
                  Internal / custom
                </button>
              </div>
            ) : null}
            <div className="webops-form-grid">
              <label className="field">
                <span>Platform</span>
                <input value={draft.platform} onChange={(event) => set("platform", event.target.value)} placeholder="WordPress, Webflow…" />
              </label>
              <label className="field">
                <span>Tier</span>
                <input value={draft.tier} onChange={(event) => set("tier", event.target.value)} placeholder="Web, T1…" />
              </label>
            </div>
            <label className="field">
              <span>Deliverables</span>
              <input value={draft.deliverables} onChange={(event) => set("deliverables", event.target.value)} />
            </label>
            <div className="webops-form-grid">
              <label className="field">
                <span>Started</span>
                <input type="date" value={draft.startOn} onChange={(event) => set("startOn", event.target.value)} />
              </label>
              <label className="field">
                <span>Launched</span>
                <input type="date" value={draft.launchOn} onChange={(event) => set("launchOn", event.target.value)} />
              </label>
            </div>
            <div className="webops-form-grid">
              <label className="field">
                <span>Last touch</span>
                <input type="date" value={draft.lastTouchpoint} onChange={(event) => set("lastTouchpoint", event.target.value)} />
              </label>
              <button type="button" className="btn btn-secondary" onClick={onTouch}>
                Touched today
              </button>
            </div>
            <label className="field">
              <span>Notes</span>
              <textarea rows={3} value={draft.blockers} onChange={(event) => set("blockers", event.target.value)} />
            </label>
            <label className="field">
              <span>Basecamp link</span>
              <input value={draft.basecampUrl} onChange={(event) => set("basecampUrl", event.target.value)} placeholder="https://" />
            </label>
            <label className="webops-check">
              <input
                type="checkbox"
                checked={draft.coverage}
                onChange={(event) => set("coverage", event.target.checked)}
              />
              Show on This week even without a due date
            </label>
            {draft.coverage ? (
              <label className="field">
                <span>When</span>
                <input value={draft.coverageWhen} onChange={(event) => set("coverageWhen", event.target.value)} placeholder="Mon Nov 9" />
              </label>
            ) : null}
            <p className="webops-hint">Today is {formatDeskDate(today)}.</p>
          </div>
        ) : null}
        </div>
        <div className="webops-modal-foot">
          <div className="webops-modal-actions">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onMore} aria-expanded={editor.more}>
              {editor.more ? "Hide details" : "More details"}
            </button>
          </div>
          {editor.id ? (
            <div className="webops-more-actions">
              <span>More actions</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStatus("launched")}>
                Launched
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStatus("paused")}>
                Pause
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
    created?: number;
    skipped?: number;
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
    <div className="webops-modal-back" onMouseDown={onClose}>
      <div
        className="webops-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webops-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="webops-modal-head">
          <h2 id="webops-import-title">Import a spreadsheet</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="webops-hint">
          Paste a CSV. Nothing is added until you confirm the preview. This does not change the Google Sheet.
        </p>
        <label className="field">
          <span>CSV</span>
          <textarea rows={6} value={csv} onChange={(event) => setCsv(event.target.value)} />
        </label>
        <label className="field">
          <span>Or choose a file</span>
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
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {preview ? (
          <div className="webops-preview">
            <p>
              {preview.rows.length} ready
              {preview.skipped ? ` · ${preview.skipped} already on the desk` : ""}
            </p>
            {preview.errors.map((item) => (
              <p key={item} className="webops-hint">
                {item}
              </p>
            ))}
            <ul>
              {preview.rows.slice(0, 8).map((row) => (
                <li key={`${row.draft.board}-${row.draft.name}`}>
                  {row.draft.name}
                  {row.warning ? ` — ${row.warning}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="webops-modal-actions">
          <button type="button" className="btn btn-secondary" disabled={busy || !csv.trim()} onClick={() => void run(false)}>
            Preview
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !preview || preview.rows.length === 0}
            onClick={() => void run(true)}
          >
            Add {preview?.rows.length || 0}
          </button>
        </div>
      </div>
    </div>
  );
}

function kindLabel(project: WebsiteProject): string {
  if (project.board === "landing") return "Landing page";
  if (project.projectGroup === "custom") return "Custom";
  return "Website";
}
