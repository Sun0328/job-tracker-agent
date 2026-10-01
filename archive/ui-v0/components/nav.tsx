import Link from "next/link";
import { LayoutDashboard, Sparkles } from "lucide-react";

export function Nav() {
  return (
    <div className="nav-wrap">
      <nav className="nav shell">
        <Link href="/" className="brand">
          <span className="brand-mark"><Sparkles size={17} /></span>
          JobPilot
        </Link>
        <div className="nav-links">
          <Link className="nav-link" href="/"><LayoutDashboard size={15} /> Dashboard</Link>
          <Link className="nav-link nav-cta" href="/new"><Sparkles size={15} /> Analyse job</Link>
        </div>
      </nav>
    </div>
  );
}
