import { Link, useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import StatusBar from "./status-bar";

interface NavItem {
  label: string;
  href: string;
  icon: string;
  shortcut: string; // second key after 'g'
}

const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: "\u2302", shortcut: "H" },
  { label: "Review", href: "/review", icon: "\u2714", shortcut: "R" },
  { label: "Workspaces", href: "/workspaces", icon: "\u2750", shortcut: "W" },
  { label: "Sessions", href: "/sessions", icon: "\u2630", shortcut: "S" },
  { label: "Agents", href: "/agents", icon: "\u2699", shortcut: "A" },
  { label: "Settings", href: "/settings", icon: "\u2638", shortcut: "," },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  // Global "g then <key>" navigation (Linear-style)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!pendingG.current) {
          pendingG.current = true;
          if (gTimer.current) clearTimeout(gTimer.current);
          gTimer.current = setTimeout(() => {
            pendingG.current = false;
          }, 500);
          return;
        }
      }

      if (pendingG.current) {
        pendingG.current = false;
        if (gTimer.current) clearTimeout(gTimer.current);

        const key = e.key.toLowerCase();
        const match = navItems.find(
          (item) => item.shortcut.toLowerCase() === key
        );
        if (match) {
          e.preventDefault();
          navigate(match.href);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return (
    <aside className="flex h-full w-[200px] flex-col border-r border-[#1e2231] bg-[#0f1117]">
      {/* App title / drag region */}
      <div className="drag-region flex h-14 items-center gap-2 px-4">
        <span className="text-base font-bold text-amber-400">{"\u25C8"}</span>
        <span className="text-[13px] font-semibold tracking-wide text-slate-200">
          CodeVetter
        </span>
      </div>

      {/* Navigation */}
      <nav className="no-drag mt-1 flex flex-1 flex-col gap-0.5 px-2">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              className={`group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-amber-500/10 text-amber-400"
                  : "text-slate-500 hover:bg-[#1a1d27] hover:text-slate-200"
              }`}
            >
              <span className="w-4 text-center text-sm">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              <kbd className="hidden group-hover:inline text-[9px] font-mono text-slate-600 bg-[#1e2231] rounded px-1 py-0.5">
                g {item.shortcut.toLowerCase()}
              </kbd>
            </Link>
          );
        })}
      </nav>

      {/* System resource monitor */}
      <StatusBar />

      {/* Bottom section */}
      <div className="border-t border-[#1e2231] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-semibold text-amber-400">
            S
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-slate-400">
              Sarthak
            </span>
            <span className="text-[9px] text-slate-600">Local</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
