/* ---------------------------------------------------------------------------
   Server side page gates
   ---------------------------------------------------------------------------
   Hiding a link is not access control. Every gated page therefore also has a
   route segment layout that calls one of these, so a bookmarked or guessed URL
   lands somewhere harmless instead of rendering a shell whose API calls happen
   to come back empty.

   Home is the destination on refusal rather than the login page: the person is
   signed in, they simply do not have this one. Sending them to /login would
   read as "you are logged out" and have them typing a password that works.
   ------------------------------------------------------------------------- */

import { redirect } from "next/navigation";
import { allows } from "./access";
import { accessSubject } from "./auth";

/** Refuse a page unless the session holds its capability. */
export async function requirePage(capability: string): Promise<void> {
  const who = await accessSubject();
  if (!who) redirect("/login");
  if (!allows(who, capability)) redirect("/admin/hub");
}

/** Refuse a page unless this is the owner. */
export async function requireOwnerPage(): Promise<void> {
  const who = await accessSubject();
  if (!who) redirect("/login");
  if (!who.owner) redirect("/admin/hub");
}
