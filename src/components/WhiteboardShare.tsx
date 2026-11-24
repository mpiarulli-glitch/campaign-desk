"use client";

import { useEffect, useId, useState } from "react";

type Role = "owner" | "editor" | "viewer";
type Person = { slug: string; label: string };
type Member = { slug: string; label: string; role: Role };

export function WhiteboardShare({
  boardId,
  onClose,
}: {
  boardId: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const [people, setPeople] = useState<Person[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/whiteboard/people").then((res) => (res.ok ? res.json() : null)),
      fetch(`/api/whiteboard/${boardId}/members`).then((res) => (res.ok ? res.json() : null)),
    ]).then(([peopleData, memberData]) => {
      if (!live) return;
      if (peopleData?.people) setPeople(peopleData.people);
      if (memberData?.members) setMembers(memberData.members);
    });
    return () => {
      live = false;
    };
  }, [boardId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const memberSlugs = new Set(members.map((member) => member.slug));
  const available = people.filter((person) => !memberSlugs.has(person.slug));

  async function invite() {
    if (!pick || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/whiteboard/${boardId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userSlug: pick, role }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not add that person.");
      return;
    }
    const data = await res.json();
    if (data.members) setMembers(data.members);
    setPick("");
  }

  async function changeRole(slug: string, next: "editor" | "viewer") {
    setMembers((current) =>
      current.map((member) => (member.slug === slug ? { ...member, role: next } : member))
    );
    const res = await fetch(`/api/whiteboard/${boardId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userSlug: slug, role: next }),
    });
    if (!res.ok) setError("Could not change that role.");
  }

  async function remove(slug: string) {
    setMembers((current) => current.filter((member) => member.slug !== slug));
    const res = await fetch(`/api/whiteboard/${boardId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userSlug: slug }),
    });
    if (!res.ok) setError("Could not remove that person.");
  }

  return (
    <div className="wb-modal" onMouseDown={onClose}>
      <div
        className="wb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="wb-share-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="wb-dialog-head">
          <h2 id={titleId}>Share</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="wb-note">They’ll see this board in their Whiteboards list.</p>

        <div className="wb-invite">
          <label className="wb-field">
            <span>Teammate</span>
            <select
              value={pick}
              onChange={(event) => setPick(event.target.value)}
              disabled={!available.length}
            >
              <option value="">{available.length ? "Choose someone" : "Everyone is here"}</option>
              {available.map((person) => (
                <option key={person.slug} value={person.slug}>
                  {person.label}
                </option>
              ))}
            </select>
          </label>
          <label className="wb-field">
            <span>Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value === "viewer" ? "viewer" : "editor")}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button type="button" className="btn btn-sm" onClick={invite} disabled={!pick || busy}>
            Invite
          </button>
        </div>
        {error ? <p className="wb-error">{error}</p> : null}

        <ul className="wb-members">
          {members.map((member) => (
            <li key={member.slug}>
              <span className="wb-member-name">{member.label}</span>
              {member.role === "owner" ? (
                <span className="wb-role">Owner</span>
              ) : (
                <>
                  <select
                    aria-label={`Role for ${member.label}`}
                    value={member.role}
                    onChange={(event) =>
                      changeRole(member.slug, event.target.value === "viewer" ? "viewer" : "editor")
                    }
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => remove(member.slug)}
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
