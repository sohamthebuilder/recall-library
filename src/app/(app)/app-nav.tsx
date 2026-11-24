"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavCounts {
  /** Things waiting for the learner (Today's "Needs you"). */
  needsYou: number;
  /** Recall Prompts due today. */
  due: number;
}

const items = [
  { href: "/", label: "Today", icon: "☀", match: (p: string) => p === "/" },
  { href: "/library", label: "Library", icon: "▤", match: (p: string) => p.startsWith("/library") || p.startsWith("/sources") },
  { href: "/topics", label: "Topics", icon: "◇", match: (p: string) => p.startsWith("/topics") },
  { href: "/review", label: "Review", icon: "↻", match: (p: string) => p.startsWith("/review") || p.startsWith("/practice") },
] as const;

function count(label: string, counts: NavCounts) {
  if (label === "Today" && counts.needsYou > 0) {
    return (
      <span className="nav-badge" aria-label={`${counts.needsYou} need you`}>
        {counts.needsYou}
      </span>
    );
  }
  if (label === "Review" && counts.due > 0) {
    return (
      <span className="nav-count" aria-label={`${counts.due} due`}>
        {counts.due}
      </span>
    );
  }
  return null;
}

/** Side rail on a laptop, bottom tab bar on a phone. The page you're on is marked. */
export function AppNav({ counts, signOut }: { counts: NavCounts; signOut: React.ReactNode }) {
  const pathname = usePathname();
  const links = items.map((item) => {
    const active = item.match(pathname);
    return (
      <Link key={item.href} href={item.href} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined}>
        <span className="nav-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="nav-label">{item.label}</span>
        {count(item.label, counts)}
      </Link>
    );
  });
  const addActive = pathname.startsWith("/add");

  return (
    <>
      <header className="phone-header">
        <Link href="/" className="brand">
          Recall Library
        </Link>
        <div className="phone-header-actions">
          {signOut}
          <Link href="/add" className={addActive ? "add-button active" : "add-button"}>
            + Add
          </Link>
        </div>
      </header>
      <nav className="rail" aria-label="Main">
        <Link href="/" className="brand">
          Recall Library
        </Link>
        <Link href="/add" className={addActive ? "add-button active" : "add-button"}>
          + Add
        </Link>
        <div className="rail-links">{links}</div>
        <div className="rail-foot">{signOut}</div>
      </nav>
      <nav className="tab-bar" aria-label="Main">
        {links}
      </nav>
    </>
  );
}
