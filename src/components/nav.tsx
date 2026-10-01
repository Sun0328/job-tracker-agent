"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Sparkles } from "lucide-react";

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      <div className="nav-links">
        <Link className="nav-link" href="/" data-active={pathname === "/"}>
          <Sparkles size={15} />
          Analyse a job
        </Link>
        <Link className="nav-link" href="/dashboard" data-active={pathname.startsWith("/dashboard")}>
          <LayoutDashboard size={15} />
          Dashboard
        </Link>
      </div>
    </nav>
  );
}
