import { useEffect, useRef } from "react";

interface ShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string[];
  label: string;
}

interface ShortcutSection {
  title: string;
  items: ShortcutEntry[];
}

const sections: ShortcutSection[] = [
  {
    title: "Navigation",
    items: [
      { keys: ["\u2318", "K"], label: "Command palette" },
      { keys: ["\u2318", ","], label: "Settings" },
      { keys: ["g", "h"], label: "Home" },
      { keys: ["g", "r"], label: "Review" },
      { keys: ["g", "w"], label: "Workspaces" },
      { keys: ["g", "s"], label: "Sessions" },
      { keys: ["g", "a"], label: "Agents" },
    ],
  },
  {
    title: "Chat",
    items: [
      { keys: ["\u2318", "T"], label: "New tab" },
      { keys: ["\u2318", "W"], label: "Close tab" },
      { keys: ["\u2318", "L"], label: "Focus input" },
      { keys: ["Ctrl", "Tab"], label: "Next tab" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: ["\u2318", "."], label: "Zen mode" },
      { keys: ["Ctrl", "`"], label: "Toggle terminal" },
    ],
  },
  {
    title: "Actions",
    items: [
      { keys: ["\u2318", "\u21E7", "R"], label: "Review code" },
      { keys: ["\u2318", "\u21E7", "Y"], label: "Commit & push" },
      { keys: ["\u2318", "\u21E7", "G"], label: "Open in GitHub" },
      { keys: ["\u2318", "N"], label: "New workspace" },
      { keys: ["\u2318", "F"], label: "Search" },
      { keys: ["\u2318", "/"], label: "This help" },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] bg-[#1e2231] rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-300">
      {children}
    </kbd>
  );
}

export default function ShortcutsHelp({ isOpen, onClose }: ShortcutsHelpProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="max-w-md w-full bg-[#13151c] border border-[#1e2231] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1e2231]">
          <h2 className="text-sm font-semibold text-slate-100">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
          >
            {"\u2715"}
          </button>
        </div>

        {/* Sections */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-5">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-[10px] uppercase tracking-wider text-slate-600 mb-2 select-none">
                {section.title}
              </h3>
              <div className="space-y-1.5">
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-[12px] text-slate-400">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-[#1e2231] px-5 py-2.5">
          <p className="text-[10px] text-slate-600">
            Press <Kbd>Esc</Kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}
