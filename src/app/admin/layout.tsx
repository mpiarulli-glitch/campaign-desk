import { AppShell } from "@/components/AppShell";

// App-wide chrome for every internal page: persistent left sidebar + top bar
// (search, notifications, profile). Individual pages render only their content.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
