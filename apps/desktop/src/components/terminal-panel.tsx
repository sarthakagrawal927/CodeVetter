import { useEffect, useRef } from "react";
import {
  spawnTerminal,
  writeTerminal,
  resizeTerminal,
  closeTerminal,
  onTerminalOutput,
  isTauriAvailable,
} from "@/lib/tauri-ipc";

interface TerminalPanelProps {
  cwd: string;
  terminalId: string;
}

const THEME = {
  background: "#0a0b0f",
  foreground: "#e2e8f0",
  cursor: "#d4a039",
  cursorAccent: "#0a0b0f",
  selectionBackground: "#d4a03930",
  black: "#1e2231",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e2e8f0",
  brightBlack: "#475569",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
};

export default function TerminalPanel({ cwd, terminalId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // We hold refs so cleanup can access the latest values without re-running the effect.
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    // Dynamic imports — xterm.js touches the DOM and cannot be imported at SSR time.
    async function init() {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);

      // Import xterm CSS (Vite handles this as a side-effect import)
      await import("@xterm/xterm/css/xterm.css");

      if (cancelled || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      const term = new Terminal({
        theme: THEME,
        fontSize: 13,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        cursorBlink: true,
        allowProposedApi: true,
        scrollback: 5000,
      });

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(containerRef.current);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Initial fit
      fitAddon.fit();

      // Spawn the PTY backend
      if (isTauriAvailable() && !spawnedRef.current) {
        spawnedRef.current = true;

        try {
          await spawnTerminal(cwd, terminalId);
        } catch (err) {
          term.writeln(`\r\n\x1b[31mFailed to spawn terminal: ${err}\x1b[0m`);
          return;
        }

        // Send initial resize so PTY matches xterm dimensions
        resizeTerminal(terminalId, term.cols, term.rows).catch(() => {});

        // Listen for PTY output
        const unlisten = await onTerminalOutput((event) => {
          if (event.terminal_id !== terminalId) return;
          // Decode base64 data
          const bytes = Uint8Array.from(atob(event.data), (c) =>
            c.charCodeAt(0)
          );
          term.write(bytes);
        });

        // Forward user keystrokes to the PTY
        const onDataDisposable = term.onData((data) => {
          writeTerminal(terminalId, data).catch(() => {});
        });

        cleanupRef.current = () => {
          onDataDisposable.dispose();
          unlisten();
          closeTerminal(terminalId).catch(() => {});
        };
      }

      // Resize observer
      const observer = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          if (isTauriAvailable()) {
            resizeTerminal(terminalId, term.cols, term.rows).catch(() => {});
          }
        } catch {
          // ignore
        }
      });
      if (containerRef.current) {
        observer.observe(containerRef.current);
      }

      // Store observer cleanup
      const prevCleanup = cleanupRef.current;
      cleanupRef.current = () => {
        observer.disconnect();
        prevCleanup?.();
      };
    }

    init();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      fitAddonRef.current = null;
      spawnedRef.current = false;
    };
    // We intentionally depend on terminalId + cwd so a new terminal is created
    // if the workspace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, cwd]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ background: THEME.background }}
    />
  );
}
