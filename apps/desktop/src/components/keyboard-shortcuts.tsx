import { useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import ShortcutsHelp from "./shortcuts-help";

/**
 * Centralized keyboard shortcut manager.
 * Mount once in the Shell component. Registers global keydown listeners
 * for shortcuts that aren't already handled by individual components
 * (e.g. Cmd+K in command-palette, Cmd+T/W/Ctrl+Tab in Chat.tsx, g+key in sidebar).
 */
export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const [showHelp, setShowHelp] = useState(false);
  const [, setZenMode] = useState(false);

  const closeHelp = useCallback(() => setShowHelp(false), []);

  useEffect(() => {
    function isInputFocused(e: KeyboardEvent): boolean {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if ((e.target as HTMLElement)?.isContentEditable) return true;
      return false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // ─── Meta + key shortcuts (work even in inputs) ────────────

      // Cmd+. — zen mode (dispatch event for panels to react)
      if (meta && !e.shiftKey && e.key === ".") {
        e.preventDefault();
        setZenMode((prev) => {
          const next = !prev;
          window.dispatchEvent(
            new CustomEvent("codevetter:zen-mode", { detail: { zen: next } })
          );
          return next;
        });
        return;
      }

      // Cmd+, — settings
      if (meta && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
        return;
      }

      // Cmd+N — new workspace
      if (meta && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        navigate("/workspaces?create=1");
        return;
      }

      // Cmd+P — file picker (navigate to workspaces files)
      if (meta && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        navigate("/workspaces?tab=files");
        return;
      }

      // Cmd+L — focus chat input (dispatch custom event, pages handle it)
      if (meta && !e.shiftKey && e.key === "l") {
        // Let Chat.tsx and Workspaces.tsx handle this — don't preventDefault here
        // They already have their own listeners for Cmd+L
        return;
      }

      // Cmd+F — focus search
      if (meta && !e.shiftKey && e.key === "f") {
        // Dispatch custom event for current page to handle
        window.dispatchEvent(new CustomEvent("codevetter:focus-search"));
        // Don't prevent default — allow native browser search as fallback
        return;
      }

      // Cmd+/ — shortcuts cheatsheet
      if (meta && !e.shiftKey && e.key === "/") {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        return;
      }

      // Cmd+Shift+R — open board (review/test actions)
      if (meta && e.shiftKey && e.key === "R") {
        e.preventDefault();
        navigate("/board");
        return;
      }

      // Cmd+Shift+G — open in GitHub
      if (meta && e.shiftKey && e.key === "G") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("codevetter:open-github"));
        return;
      }

      // Cmd+Shift+Y — commit and push
      if (meta && e.shiftKey && e.key === "Y") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("codevetter:commit-push"));
        return;
      }

      // Ctrl+` — toggle terminal
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("codevetter:toggle-terminal"));
        return;
      }

      // ─── Non-meta shortcuts (skip when typing in inputs) ────────────

      if (isInputFocused(e)) return;

      // 1-9 — quick model switch
      if (!meta && !e.altKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
        const models: Record<string, string> = {
          "1": "haiku",
          "2": "sonnet",
          "3": "opus",
        };
        const model = models[e.key];
        if (model) {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("codevetter:switch-model", {
              detail: { model },
            })
          );
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return <ShortcutsHelp isOpen={showHelp} onClose={closeHelp} />;
}
