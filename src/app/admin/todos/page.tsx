import { redirect } from "next/navigation";

// Sunset 2026-07-31. The in-app to-do list is retired for every role, including
// the owner. Kept as a redirect so old links and bookmarks land somewhere
// sensible instead of 404ing.
//
// Forecast to-dos are a separate, still-live feature backed by Basecamp, at
// /admin/forecast. The Team Hub keeps its own to-do panel.
export default function RetiredTodosPage() {
  redirect("/admin");
}
