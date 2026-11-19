"use client";

import { useParams } from "next/navigation";
import { Brand } from "@/components/Brand";
import { ScheduleBooking } from "@/components/ScheduleBooking";
import { SkipLink } from "@/components/SkipLink";

export default function SchedulePage() {
  const { token } = useParams<{ token: string }>();
  return (
    <div className="app-shell client-light">
      <SkipLink />
      <header className="topbar">
        <Brand href="/" />
      </header>
      <main id="main" className="container stack sched-main">
        <ScheduleBooking apiPath={`/api/schedule/${token}`} />
      </main>
    </div>
  );
}
