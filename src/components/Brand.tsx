export function Brand({ href }: { href?: string }) {
  const content = (
    <>
      <img
        src="/meg-logo.png"
        alt="Marketing Empire Group"
        className="brand-logo"
        width={180}
        height={45}
      />
      <div className="brand-divider" aria-hidden="true" />
      <div className="brand-copy">
        <strong>Campaign Desk</strong>
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} className="brand">
        {content}
      </a>
    );
  }

  return <div className="brand">{content}</div>;
}
