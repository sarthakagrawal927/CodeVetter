import { Link, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Home, FolderGit2, Kanban, Clock, Settings } from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  shortcut: string;
}

const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: <Home size={18} />, shortcut: "H" },
  { label: "Workspaces", href: "/workspaces", icon: <FolderGit2 size={18} />, shortcut: "W" },
  { label: "Board", href: "/board", icon: <Kanban size={18} />, shortcut: "B" },
  { label: "History", href: "/history", icon: <Clock size={18} />, shortcut: "Y" },
  { label: "Settings", href: "/settings", icon: <Settings size={18} />, shortcut: "," },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide state
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  // Find current page label
  const currentPage =
    navItems.find((item) => isActive(item.href))?.label ?? "";

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

  // Show nav when mouse is near the top of the window
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (e.clientY < 50) {
        setVisible(true);
        clearTimeout(hideTimer.current);
      }
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Start hide timer on initial mount (hide after 2s if user doesn't hover)
  useEffect(() => {
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(hideTimer.current);
  }, []);

  const handleMouseEnter = () => {
    clearTimeout(hideTimer.current);
    setVisible(true);
  };

  const handleMouseLeave = () => {
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
  };

  return (
    <nav
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`no-drag fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[#1e2231] bg-[#13151c]/90 px-4 py-2 shadow-xl backdrop-blur-md transition-all duration-300 ease-in-out ${
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-2 opacity-0"
      }`}
    >
      {/* App icon */}
      <span className="mr-2 text-base font-bold text-amber-400">
        {"\u25C8"}
      </span>

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-[#1e2231]" />

      {/* Nav items */}
      {navItems.map((item) => {
        const active = isActive(item.href);
        return (
          <div
            key={item.href}
            className="relative flex flex-col items-center"
            onMouseEnter={() => setHoveredItem(item.href)}
            onMouseLeave={() => setHoveredItem(null)}
          >
            <Link
              to={item.href}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-[18px] transition-colors duration-200 ${
                active
                  ? "bg-amber-500/15 text-amber-400"
                  : "text-slate-500 hover:bg-[#1e2231] hover:text-slate-200"
              }`}
            >
              {item.icon}
            </Link>

            {/* Tooltip */}
            {hoveredItem === item.href && (
              <span className="absolute top-full mt-2 whitespace-nowrap rounded border border-[#1e2231] bg-[#13151c] px-2 py-1 text-[10px] text-slate-400">
                {item.label}
                <span className="ml-1.5 font-mono text-slate-600">
                  g {item.shortcut.toLowerCase()}
                </span>
              </span>
            )}
          </div>
        );
      })}

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-[#1e2231]" />

      {/* Current page name */}
      <span className="ml-1 text-[11px] font-medium text-slate-500">
        {currentPage}
      </span>
    </nav>
  );
}
