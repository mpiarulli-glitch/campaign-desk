// One-time cleanup of two leftover client rows, run once on startup.
//
// "Krak Boba" is the legacy account from before Corporate / Oceanside / Temecula
// were split into their own clients. It still held 22 snapshot deliverables and
// 2 entries, so those move to Krak Boba Corporate before the row goes, rather
// than being cascade-deleted with it. "Carlos" was a stray row with no project,
// no retainer and no production enrolment.
//
// Matched on id AND name together: if either has changed, the row is not what
// this cleanup was written against and it is skipped rather than guessed at.

import { getDb, nowIso } from "./db";

const CLEANUP_KEY = "client_cleanup_krakboba_carlos_v1";

const KRAK_BOBA_ID = "9l3hcFQfsQlG";
const KRAK_BOBA_NAME = "Krak Boba";
const KRAK_CORP_ID = "lzjzFBiqlPQH";
const KRAK_CORP_NAME = "Krak Boba Corporate";
const CARLOS_ID = "z3zlb7mEqi88";
const CARLOS_NAME = "Carlos";

function cleanupDone(): boolean {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(CLEANUP_KEY) as { value: string } | undefined;
  return Boolean(row?.value);
}

function markDone(summary: string) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(CLEANUP_KEY, summary, nowIso());
}

function findClient(id: string, name: string) {
  return getDb()
    .prepare(`SELECT id, name FROM rev_clients WHERE id = ? AND name = ?`)
    .get(id, name) as { id: string; name: string } | undefined;
}

export function runClientCleanupOnce(): void {
  try {
    if (cleanupDone()) return;
    const db = getDb();
    const notes: string[] = [];

    const krak = findClient(KRAK_BOBA_ID, KRAK_BOBA_NAME);
    const corp = findClient(KRAK_CORP_ID, KRAK_CORP_NAME);
    const carlos = findClient(CARLOS_ID, CARLOS_NAME);

    // All of it in one transaction: moving the deliverables and dropping the row
    // they used to belong to must not be able to half-apply.
    db.exec("BEGIN");
    try {
      if (krak && corp) {
        const ts = nowIso();
        const d = db
          .prepare(
            `UPDATE snapshot_deliverables SET client_id = ?, updated_at = ? WHERE client_id = ?`
          )
          .run(corp.id, ts, krak.id).changes;
        const e = db
          .prepare(
            `UPDATE snapshot_entries SET client_id = ?, updated_at = ? WHERE client_id = ?`
          )
          .run(corp.id, ts, krak.id).changes;
        // forecast_tasks stores the client as display text, not a foreign key,
        // so it needs repointing by name or the tasks read as orphaned.
        const f = db
          .prepare(
            `UPDATE forecast_tasks SET client = ?, updated_at = ? WHERE client = ?`
          )
          .run(corp.name, ts, krak.name).changes;
        const w = db.prepare(`DELETE FROM rev_clients WHERE id = ?`).run(krak.id).changes;
        notes.push(
          `krak_boba: moved ${d} deliverables, ${e} entries, ${f} forecast tasks to ${corp.name}; deleted ${w} row`
        );
      } else {
        notes.push(
          `krak_boba: skipped (krak=${Boolean(krak)} corp=${Boolean(corp)}) — row did not match expected id+name`
        );
      }

      if (carlos) {
        // The 2 snapshot wins on this row cascade away with it, which is the
        // intent — it was a stray row, not an account.
        const n = db.prepare(`DELETE FROM rev_clients WHERE id = ?`).run(carlos.id).changes;
        notes.push(`carlos: deleted ${n} row (snapshot wins cascade)`);
      } else {
        notes.push("carlos: skipped — row did not match expected id+name");
      }

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      console.error("[client-cleanup] rolled back", (err as Error).message);
      return;
    }

    const summary = `${notes.join(" | ")} at=${nowIso()}`;
    markDone(summary);
    console.log(`[client-cleanup] ${summary}`);
  } catch (err) {
    console.error("[client-cleanup] failed", (err as Error).message);
  }
}
