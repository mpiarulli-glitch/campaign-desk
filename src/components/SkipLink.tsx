export function SkipLink({ href = "#main" }: { href?: string }) {
  return (
    <a className="skip-link" href={href}>
      Skip to content
    </a>
  );
}
