import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getSession,
  sendChatMessage,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { WorkspaceRow } from "@/lib/tauri-ipc";
import { useChatStream } from "@/hooks/use-chat-stream";
import ContextMeter from "@/components/context-meter";

// ─── Chat message type for local state ──────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

type ChatState = "idle" | "waiting" | "streaming";

function convertSessionMessages(
  msgs: { role: string | null; content_text: string | null }[]
): ChatMessage[] {
  return msgs
    .filter((m) => m.content_text?.trim())
    .filter(
      (m) => m.role === "user" || m.role === "human" || m.role === "assistant"
    )
    .map((m) => ({
      role: (m.role === "human" ? "user" : m.role) as "user" | "assistant",
      content: m.content_text!,
    }));
}

function repoName(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() || repoPath;
}

// ─── Workspace Chat Panel (center) ──────────────────────────────────────────

export default function WorkspaceChat({
  workspace,
  onSessionCreated,
}: {
  workspace: WorkspaceRow;
  onSessionCreated: (sessionId: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("sonnet");
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [planMode, setPlanMode] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | undefined>(workspace.session_id ?? undefined);

  // Track current workspace to detect changes
  const prevWorkspaceId = useRef(workspace.id);

  // ─── Stream handler ─────────────────────────────────────────────────────

  const { sending, streamingText, stats: chatStats, activityStep } = useChatStream({
    onAssistantDone(text, newSessionId) {
      setChatState("idle");
      if (text.trim()) {
        setMessages((prev) => [...prev, { role: "assistant", content: text }]);
      }
      if (newSessionId && newSessionId !== sessionIdRef.current) {
        sessionIdRef.current = newSessionId;
        onSessionCreated(newSessionId);
      }
      inputRef.current?.focus();
    },
    onSystemMessage(text) {
      setChatState("idle");
      setMessages((prev) => [...prev, { role: "system", content: text }]);
    },
    onTextUpdate() {
      if (chatState !== "streaming") setChatState("streaming");
    },
  });

  // Sync sending state
  useEffect(() => {
    if (sending && chatState === "waiting") setChatState("streaming");
  }, [sending, chatState]);

  // ─── Load history when workspace changes ────────────────────────────────

  useEffect(() => {
    if (prevWorkspaceId.current !== workspace.id) {
      prevWorkspaceId.current = workspace.id;
      setMessages([]);
      setChatState("idle");
      setInput("");
      sessionIdRef.current = workspace.session_id ?? undefined;
    }

    if (!workspace.session_id || !isTauriAvailable()) {
      setLoadingHistory(false);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);

    (async () => {
      try {
        const { messages: msgs } = await getSession(workspace.session_id!);
        if (cancelled) return;
        setMessages(convertSessionMessages(msgs));
      } catch (err) {
        console.error("Failed to load workspace session:", err);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspace.id, workspace.session_id]);

  // ─── Auto-scroll ──────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, loadingHistory, chatState]);

  // ─── Send ─────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || chatState !== "idle") return;

    const finalMsg = planMode ? `/plan ${msg}` : msg;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatState("waiting");

    try {
      await sendChatMessage(
        finalMsg,
        sessionIdRef.current,
        workspace.repo_path,
        thinkingEnabled ? `${model}-thinking` : model
      );
    } catch (err) {
      setChatState("idle");
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }
  }, [input, chatState, workspace.repo_path, model, thinkingEnabled, planMode]);

  const isBusy = chatState !== "idle";

  // ─── Markdown prose classes (matching chat-viewer.tsx) ─────────────────────

  const proseClasses =
    "text-sm leading-relaxed text-slate-300 prose prose-invert prose-sm max-w-none prose-pre:bg-[#0d0f16] prose-pre:border prose-pre:border-[#1a1a1a] prose-pre:rounded-lg prose-code:text-amber-300 prose-code:before:content-[''] prose-code:after:content-[''] prose-a:text-amber-400 prose-strong:text-slate-200 prose-headings:text-slate-200 prose-li:marker:text-slate-500";

  return (
    <div className="flex h-full flex-col">
      {/* Chat header */}
      <div className="flex items-center gap-2 border-b border-[#1a1a1a] px-4 py-2.5 shrink-0 overflow-hidden">
        <div className="flex items-center gap-1.5 rounded-md bg-[#111111] px-2.5 py-1 text-[11px] text-slate-300 font-medium min-w-0">
          <span className="text-slate-500 shrink-0">#</span>
          <span className="truncate">{workspace.name}</span>
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-600 font-mono truncate shrink-0 max-w-[120px]">
          {workspace.branch}
        </span>
        {workspace.session_id && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-400 font-mono">
            {workspace.session_id.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loadingHistory ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <span className="text-[12px] text-slate-500">
              Loading session history...
            </span>
          </div>
        ) : messages.length === 0 && chatState === "idle" ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="text-slate-600 text-[13px] text-center max-w-md">
              <p className="text-slate-400 font-medium mb-2">
                Start working on {workspace.name}
              </p>
              <p>
                Send a message to begin coding. Claude has context of{" "}
                <span className="text-slate-400 font-mono text-[12px]">
                  {repoName(workspace.repo_path)}
                </span>
                .
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => {
              if (msg.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] rounded-lg bg-amber-500/15 px-4 py-3 overflow-hidden">
                      <p className="text-[13px] text-slate-200 whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                );
              }
              if (msg.role === "system") {
                return null; // Hide system/init messages
              }
              // assistant
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                      Claude
                    </span>
                  </div>
                  <div className="rounded-lg bg-[#161922] border border-[#1a1a1a] px-4 py-3 overflow-hidden">
                    <div className={proseClasses}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Streaming / waiting state */}
            {chatState !== "idle" && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                    Claude
                  </span>
                </div>
                <div className="rounded-lg bg-[#161922] border border-[#1a1a1a] px-4 py-3">
                  {chatState === "streaming" && streamingText ? (
                    <div className={proseClasses}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingText}
                      </ReactMarkdown>
                      <span className="inline-block w-1.5 h-4 bg-amber-400/50 animate-pulse ml-0.5 align-text-bottom" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          style={{
                            animation: "pulse 1s ease-in-out infinite",
                          }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          style={{
                            animation: "pulse 1s ease-in-out infinite 200ms",
                          }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          style={{
                            animation: "pulse 1s ease-in-out infinite 400ms",
                          }}
                        />
                      </div>
                      <span className="text-[12px] text-slate-500">
                        {activityStep
                          ? `${activityStep.label}${activityStep.detail ? ` ${activityStep.detail}` : ""}...`
                          : "Working..."}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-[#1a1a1a] px-3 py-2.5 overflow-hidden">
        <div className="flex items-end gap-2 min-w-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              isBusy
                ? "Waiting for response..."
                : "Ask to make changes, @mention files, run /commands"
            }
            disabled={isBusy}
            rows={1}
            className="flex-1 min-w-0 resize-none rounded-lg border border-[#1a1a1a] bg-[#0f1117] px-3 py-2 text-[13px] text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50 disabled:opacity-50 max-h-24"
            style={{ height: "auto", minHeight: "36px" }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 96) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={isBusy || !input.trim()}
            className="rounded-lg bg-amber-500 px-3 py-2 text-[11px] font-medium text-white hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isBusy ? "..." : "Send"}
          </button>
        </div>

        {/* Bottom toolbar: model, thinking, plan */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isBusy}
            className="rounded border border-[#1a1a1a] bg-[#0f1117] px-2 py-1 text-[10px] text-slate-400 outline-none focus:border-amber-500/50 cursor-pointer"
          >
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
          </select>

          <button
            onClick={() => setThinkingEnabled(!thinkingEnabled)}
            disabled={isBusy}
            className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              thinkingEnabled
                ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                : "text-slate-500 hover:text-slate-300 border border-[#1a1a1a]"
            }`}
          >
            Thinking
          </button>

          <button
            onClick={() => setPlanMode(!planMode)}
            disabled={isBusy}
            className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              planMode
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "text-slate-500 hover:text-slate-300 border border-[#1a1a1a]"
            }`}
          >
            Plan
          </button>

          <span className="ml-auto flex items-center gap-2">
            <ContextMeter
              inputTokens={chatStats.inputTokens}
              outputTokens={chatStats.outputTokens}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
