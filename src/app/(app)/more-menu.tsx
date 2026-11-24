/** A "⋯" menu that keeps secondary and destructive actions out of the way until opened. */
export function MoreMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="more-menu">
      <summary aria-label={label} title={label}>
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="more-menu-items">{children}</div>
    </details>
  );
}
