"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
import { TodoList } from "@/components/TodoList";

export default function TodosPage() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.authenticated) router.push("/login");
      })
      .catch(() => {});
  }, [router]);

  return (
    <div className="ops-scope">
      <header className="topbar">
        <Brand href="/admin" />
        <NavMenu current="/admin/todos" />
      </header>

      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">Team</p>
            <h1 className="ops-title">To-dos.</h1>
            <p className="ops-sub">Everything the team owns, client work and general ops. Assign it, tag people, set a due date.</p>
          </div>
        </div>

        <div className="ops-panel" style={{ padding: 20 }}>
          <TodoList showClient title="All to-dos" />
        </div>
      </div>
    </div>
  );
}
