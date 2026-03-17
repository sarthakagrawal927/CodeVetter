import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import Sidebar from "@/components/sidebar";
import Onboarding from "@/components/onboarding";
import CommandPalette from "@/components/command-palette";
import KeyboardShortcuts from "@/components/keyboard-shortcuts";
import { getPreference, isTauriAvailable } from "@/lib/tauri-ipc";

// Pages
import Home from "@/pages/Home";
import Sessions from "@/pages/Sessions";
import Agents from "@/pages/Agents";
import Workspaces from "@/pages/Workspaces";
import Usage from "@/pages/Usage";
import Settings from "@/pages/Settings";

/** Hook: open/close command palette via Cmd+K */
function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, close };
}

function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (localStorage.getItem("onboarding_complete") === "true") {
        setReady(true);
        return;
      }
      if (!isTauriAvailable()) {
        setReady(true);
        return;
      }
      try {
        const completed = await getPreference("onboarding_complete");
        if (completed === "true") {
          localStorage.setItem("onboarding_complete", "true");
        } else {
          setShowOnboarding(true);
        }
      } catch {
        // If preferences aren't available yet, show the app anyway
      }
      setReady(true);
    })();
  }, []);

  return { showOnboarding, setShowOnboarding, ready };
}

/** Main shell: floating nav + full-width content area */
function Shell() {
  const { showOnboarding, setShowOnboarding, ready } = useOnboarding();
  const { isOpen, close } = useCommandPalette();

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f1117]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}
      <Sidebar />
      <main className="flex-1 h-full overflow-y-auto pt-2">
        <Outlet />
      </main>
      <CommandPalette isOpen={isOpen} onClose={close} />
      <KeyboardShortcuts />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/workspaces" element={<Workspaces />} />
        <Route path="/history" element={<Sessions />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/board" element={<Agents />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
