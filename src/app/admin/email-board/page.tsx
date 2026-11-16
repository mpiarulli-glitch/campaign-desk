import { Suspense } from "react";
import { EmailBoard } from "@/components/EmailBoard";

export default function EmailBoardPage() {
  return (
    <Suspense
      fallback={
        <div className="eb-fill">
          <p className="eb-loading">Loading the board…</p>
        </div>
      }
    >
      <EmailBoard />
    </Suspense>
  );
}
