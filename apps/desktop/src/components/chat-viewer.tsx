import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageRow, SessionRow } from "@/lib/tauri-ipc";
import { sendChatMessage, isTauriAvailable } from "@/lib/tauri-ipc";
import { useChatStream } from "@/hooks/use-chat-stream";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Lightweight message added during a live resume chat (not from DB). */
interface LocalChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface ChatViewerProps {
  messages: MessageRow[];
  session?: SessionRow;
  title?: string;
  isLoading?: boolean;
  /** Called after a resumed chat completes so the parent can refresh. */
  onSessionResumed?: () => void;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function formatTimestamp(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatRelativeTimestamp(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTokens(count: number | null | undefined): string {
  if (!count) return "";
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatSessionDuration(
  first: string | null | undefined,
  last: string | null | undefined
): string {
  if (!first || !last) return "";
  const start = new Date(first).getTime();
  const end = new Date(last).getTime();
  if (isNaN(start) || isNaN(end)) return "";
  const diffMs = end - start;
  if (diffMs < 0) return "";
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "<1m";
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function getMessageKind(
  msg: MessageRow
): "user" | "assistant" | "tool" | "system" | "progress" {
  const t = (msg.type || "").toLowerCase();
  const r = (msg.role || "").toLowerCase();

  if (t === "human" || r === "user" || t === "user") return "user";
  if (t === "tool_use" || t === "tool_result") return "tool";
  if (t === "progress") return "progress";
  if (t === "system" || r === "system") return "system";
  return "assistant";
}

const kindConfig: Record<
  ReturnType<typeof getMessageKind>,
  { label: string; color: string; bg: string }
> = {
  user: {
    label: "You",
    color: "text-amber-400",
    bg: "bg-amber-500/5",
  },
  assistant: {
    label: "Assistant",
    color: "text-emerald-400",
    bg: "bg-emerald-500/5",
  },
  tool: {
    label: "Tool",
    color: "text-amber-400",
    bg: "bg-amber-500/5",
  },
  system: {
    label: "System",
    color: "text-slate-500",
    bg: "bg-slate-500/5",
  },
  progress: {
    label: "Progress",
    color: "text-slate-600",
    bg: "bg-slate-800/30",
  },
};

// ─── Tool Message Component ─────────────────────────────────────────────────

function ToolMessageBubble({ message }: { message: MessageRow }) {
  const [expanded, setExpanded] = useState(false);
  const content = message.content_text || "";

  let toolName = "tool";
  let toolContent = content;

  try {
    const parsed = JSON.parse(content);
    if (parsed.name) toolName = parsed.name;
    if (parsed.input) toolContent = JSON.stringify(parsed.input, null, 2);
    else if (parsed.output) toolContent = JSON.stringify(parsed.output, null, 2);
    else if (parsed.content) {
      toolContent =
        typeof parsed.content === "string"
          ? parsed.content
          : JSON.stringify(parsed.content, null, 2);
    }
  } catch {
    // Not JSON, use raw content
  }

  return (
    <div className="rounded-xl bg-amber-500/5 fade-in">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-amber-500/10 rounded-xl"
      >
        <svg
          className={`h-3 w-3 text-amber-400 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-xs font-semibold text-amber-400">
          {message.type === "tool_result" ? "Tool Result" : "Tool Use"}
        </span>
        <span className="mono text-[11px] text-amber-300/70">{toolName}</span>
        <span className="ml-auto mono text-[10px] text-slate-600">
          {formatTimestamp(message.timestamp)}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/10 px-4 py-3">
          <pre className="mono whitespace-pre-wrap text-xs leading-relaxed text-slate-400 max-h-[300px] overflow-y-auto">
            {toolContent}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Message Bubble Component ───────────────────────────────────────────────

function MessageBubble({ message }: { message: MessageRow }) {
  const kind = getMessageKind(message);

  if (kind === "tool") {
    return <ToolMessageBubble message={message} />;
  }

  const config = kindConfig[kind];
  const isSidechain = message.is_sidechain === 1;

  return (
    <div
      className={`rounded-xl p-4 fade-in ${config.bg} ${
        isSidechain ? "opacity-50 border-l-2 border-slate-700 ml-4" : ""
      }`}
    >
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-semibold ${config.color}`}>
          {config.label}
        </span>
        <span className="mono text-[10px] text-slate-600">
          {formatTimestamp(message.timestamp)}
        </span>

        {kind === "assistant" && message.model && (
          <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-400">
            {message.model}
          </span>
        )}

        {kind === "assistant" &&
          (message.input_tokens || message.output_tokens) && (
            <span className="mono text-[10px] text-slate-600">
              {message.input_tokens
                ? `${formatTokens(message.input_tokens)} in`
                : ""}
              {message.input_tokens && message.output_tokens ? " / " : ""}
              {message.output_tokens
                ? `${formatTokens(message.output_tokens)} out`
                : ""}
            </span>
          )}

        {isSidechain && (
          <span className="rounded-md bg-slate-700/50 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
            sidechain
          </span>
        )}
      </div>

      {message.content_text && (
        <div className="text-sm leading-relaxed text-slate-300 prose prose-invert prose-sm max-w-none prose-pre:bg-[#0d0f16] prose-pre:border prose-pre:border-[#1e2231] prose-pre:rounded-lg prose-code:text-amber-300 prose-code:before:content-[''] prose-code:after:content-[''] prose-a:text-amber-400 prose-strong:text-slate-200 prose-headings:text-slate-200 prose-li:marker:text-slate-500">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content_text}
          </ReactMarkdown>
        </div>
      )}

      {kind === "progress" && !message.content_text && (
        <div className="text-xs text-slate-600 italic">Processing...</div>
      )}
    </div>
  );
}

// ─── Chat Viewer Component ──────────────────────────────────────────────────

export default function ChatViewer({
  messages,
  session,
  title,
  isLoading = false,
  onSessionResumed,
}: ChatViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showSidechain, setShowSidechain] = useState(false);
  const [viewMode, setViewMode] = useState<"conversation" | "full">("conversation");

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollButton(!isNearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, localMessages.length, chatSending, chatStreamingText, waitingForResponse]);

  const [searchInSession, setSearchInSession] = useState("");

  // ─── Chat input state ─────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Local messages added during a live resume chat (persisted across stream lifecycle)
  const [localMessages, setLocalMessages] = useState<LocalChatMessage[]>([]);

  // Reset local messages when session changes
  const prevSessionId = useRef(session?.id);
  useEffect(() => {
    if (session?.id !== prevSessionId.current) {
      setLocalMessages([]);
      prevSessionId.current = session?.id;
    }
  }, [session?.id]);

  // Last completed response stats (shown briefly after streaming ends)
  const [lastResponseStats, setLastResponseStats] = useState<{
    elapsedMs: number;
    inputTokens: number;
    outputTokens: number;
  } | null>(null);
  const lastStatsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatStatsRef = useRef({ elapsedMs: 0, inputTokens: 0, outputTokens: 0 });

  const [waitingForResponse, setWaitingForResponse] = useState(false);

  const { sending: chatSending, streamingText: chatStreamingText, stats: chatStats } = useChatStream({
    onAssistantDone(text) {
      setWaitingForResponse(false);
      if (text.trim()) {
        setLocalMessages((prev) => [
          ...prev,
          {
            id: `local-assistant-${Date.now()}`,
            role: "assistant",
            content: text,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      setLastResponseStats({ ...chatStatsRef.current });
      if (lastStatsTimerRef.current) clearTimeout(lastStatsTimerRef.current);
      lastStatsTimerRef.current = setTimeout(() => setLastResponseStats(null), 8000);
      onSessionResumed?.();
    },
    onSystemMessage() { setWaitingForResponse(false); },
    onTextUpdate() { setWaitingForResponse(false); },
  });

  chatStatsRef.current = chatStats;

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (lastStatsTimerRef.current) clearTimeout(lastStatsTimerRef.current);
    };
  }, []);

  const handleChatSend = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatSending || waitingForResponse || !session) return;
    setChatInput("");
    setWaitingForResponse(true);
    // Immediately show the user's message in the local chat
    setLocalMessages((prev) => [
      ...prev,
      {
        id: `local-user-${Date.now()}`,
        role: "user",
        content: msg,
        timestamp: new Date().toISOString(),
      },
    ]);
    scrollToBottom();
    try {
      await sendChatMessage(msg, session.id, session.cwd ?? undefined);
    } catch (err) {
      console.error("Failed to send message:", err);
      setLocalMessages((prev) => [
        ...prev,
        {
          id: `local-error-${Date.now()}`,
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, [chatInput, chatSending, session, scrollToBottom]);

  // Filter messages — memoized to avoid recomputing on every scroll
  const visibleMessages = useMemo(() => {
    return messages.filter((m) => {
      if (!showSidechain && m.is_sidechain === 1) return false;
      if (viewMode === "conversation") {
        const kind = getMessageKind(m);
        if (kind !== "user" && kind !== "assistant") return false;
        const text = m.content_text || "";
        if (text.startsWith("[tool_use:") || text.startsWith("[tool_result")) return false;
        if (text.startsWith("Tool:") || text.startsWith("Running:")) return false;
        if (kind === "assistant" && text.length < 3) return false;
        if (!text.trim()) return false;
      }
      if (searchInSession.trim()) {
        const q = searchInSession.toLowerCase();
        const text = (m.content_text || "").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [messages, showSidechain, viewMode, searchInSession]);

  const totalTokens = session
    ? session.total_input_tokens + session.total_output_tokens
    : 0;

  const projectName = session?.cwd
    ? session.cwd.split("/").pop() || session.cwd
    : title || "Session";

  const [copied, setCopied] = useState(false);

  // Quote paths to prevent shell injection
  const resumeCommand = session
    ? `cd "${session.cwd || "~"}" && claude --resume "${session.id}"`
    : null;

  const handleCopyResume = useCallback(() => {
    if (!resumeCommand) return;
    navigator.clipboard.writeText(resumeCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [resumeCommand]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-[#1e2231] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-200">
                {projectName}
              </h3>
              {session?.git_branch && (
                <span className="text-[11px] text-slate-500 font-mono">
                  {session.git_branch}
                </span>
              )}
            </div>
            {session?.cwd && (
              <p className="text-[11px] text-slate-600 font-mono mt-0.5">
                {session.cwd}
              </p>
            )}
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <p className="text-[11px] text-slate-500">
                {messages.length} messages
              </p>
              {session?.model_used && (
                <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-400">
                  {session.model_used}
                </span>
              )}
              {totalTokens > 0 && (
                <span className="mono text-[10px] text-slate-600">
                  {formatTokens(totalTokens)} tokens
                </span>
              )}
              {session && session.estimated_cost_usd > 0 && (
                <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-medium text-rose-400">
                  ${session.estimated_cost_usd.toFixed(2)}
                </span>
              )}
              {session && formatSessionDuration(session.first_message, session.last_message) && (
                <span className="rounded-md bg-slate-500/10 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
                  {formatSessionDuration(session.first_message, session.last_message)}
                </span>
              )}
              {session && session.compaction_count > 0 && (
                <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                  {session.compaction_count} compaction{session.compaction_count !== 1 ? "s" : ""}
                </span>
              )}
              {session && (session.cache_read_tokens > 0 || session.cache_creation_tokens > 0) && (
                <span className="mono text-[10px] text-slate-600">
                  cache: {session.cache_read_tokens > 0 ? `${formatTokens(session.cache_read_tokens)} read` : ""}
                  {session.cache_read_tokens > 0 && session.cache_creation_tokens > 0 ? " / " : ""}
                  {session.cache_creation_tokens > 0 ? `${formatTokens(session.cache_creation_tokens)} created` : ""}
                </span>
              )}
              {session?.first_message && (
                <span className="text-[10px] text-slate-600">
                  {formatRelativeTimestamp(session.first_message)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Copy resume command */}
            {resumeCommand && (
              <button
                onClick={handleCopyResume}
                title={resumeCommand}
                className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-[#1a1d27] hover:text-slate-200"
              >
                {copied ? (
                  <>
                    <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.474l6.733-3.367A2.52 2.52 0 0113 4.5z" />
                    </svg>
                    Resume
                  </>
                )}
              </button>
            )}

            {/* In-session search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search..."
                value={searchInSession}
                onChange={(e) => setSearchInSession(e.target.value)}
                className="w-36 rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 outline-none focus:border-amber-500/50 focus:w-52 transition-all"
              />
              {searchInSession && (
                <button
                  onClick={() => setSearchInSession("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>

            {/* View mode toggle */}
            <div className="flex rounded-lg border border-[#1e2231] overflow-hidden">
              <button
                onClick={() => setViewMode("conversation")}
                className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  viewMode === "conversation"
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Conversation
              </button>
              <button
                onClick={() => setViewMode("full")}
                className={`px-3 py-1.5 text-[11px] font-medium transition-colors border-l border-[#1e2231] ${
                  viewMode === "full"
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Full
              </button>
            </div>

            {/* Sidechain toggle */}
            {messages.some((m) => m.is_sidechain === 1) && (
              <button
                onClick={() => setShowSidechain(!showSidechain)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  showSidechain
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {showSidechain ? "Hide" : "Show"} sidechains
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 relative"
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-600">
            <svg
              className="h-6 w-6 animate-spin text-amber-400 mb-3"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <p className="text-xs">Loading messages...</p>
          </div>
        ) : visibleMessages.length === 0 && localMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-600">
            <span className="text-2xl mb-2">{"\u25CB"}</span>
            <p className="text-xs">No messages in this session</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleMessages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {/* Messages added during live resume chat */}
            {localMessages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-xl p-4 fade-in ${
                  msg.role === "user" ? "bg-amber-500/5" : "bg-emerald-500/5"
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      msg.role === "user" ? "text-amber-400" : "text-emerald-400"
                    }`}
                  >
                    {msg.role === "user" ? "You" : "Assistant"}
                  </span>
                  <span className="mono text-[10px] text-slate-600">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>
                <div className="text-sm leading-relaxed text-slate-300 prose prose-invert prose-sm max-w-none prose-pre:bg-[#0d0f16] prose-pre:border prose-pre:border-[#1e2231] prose-pre:rounded-lg prose-code:text-amber-300 prose-a:text-amber-400 prose-strong:text-slate-200">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Waiting for response (before streaming starts) */}
      {waitingForResponse && !chatSending && (
        <div className="px-4 pb-3">
          <div className="rounded-lg bg-[#161922] border border-[#1e2231] px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" style={{ animation: "pulse 1s ease-in-out infinite" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" style={{ animation: "pulse 1s ease-in-out infinite 200ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" style={{ animation: "pulse 1s ease-in-out infinite 400ms" }} />
              </div>
              <span className="text-[12px] text-slate-500">Connecting to Claude...</span>
            </div>
          </div>
        </div>
      )}

      {/* Streaming response */}
      {chatSending && (
        <div className="px-4 pb-3">
          <div className="rounded-lg bg-[#161922] border border-[#1e2231] px-4 py-3">
            {chatStreamingText ? (
              <div>
                <div className="text-sm leading-relaxed text-slate-300 prose prose-invert prose-sm max-w-none prose-pre:bg-[#0d0f16] prose-pre:border prose-pre:border-[#1e2231] prose-pre:rounded-lg prose-code:text-amber-300">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {chatStreamingText}
                  </ReactMarkdown>
                  <span className="inline-block w-1.5 h-4 bg-amber-400/50 animate-pulse ml-0.5 align-text-bottom" />
                </div>
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[#1e2231]">
                  <span className="text-[10px] text-slate-600 tabular-nums">
                    {chatStats.elapsedMs > 0
                      ? `${(chatStats.elapsedMs / 1000).toFixed(1)}s`
                      : ""}
                  </span>
                  {chatStats.outputTokens > 0 && (
                    <span className="text-[10px] text-slate-600 tabular-nums">
                      {formatTokens(chatStats.outputTokens)} tokens
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="flex items-center gap-1">
                    <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] text-emerald-400/70">Streaming</span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-[pulse_1s_ease-in-out_infinite]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-[pulse_1s_ease-in-out_infinite_200ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-[pulse_1s_ease-in-out_infinite_400ms]" />
                </div>
                <span className="text-[12px] text-slate-500">Thinking...</span>
                {chatStats.elapsedMs > 0 && (
                  <span className="text-[10px] text-slate-600 tabular-nums">
                    {(chatStats.elapsedMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <div className="absolute bottom-16 right-6">
          <button
            onClick={scrollToBottom}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#1e2231] bg-[#13151c] text-slate-400 shadow-lg transition-all hover:border-amber-500/40 hover:text-amber-400"
            title="Scroll to bottom"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Completion stats (shown briefly after response ends) */}
      {lastResponseStats && !chatSending && (
        <div className="px-4 pb-1">
          <div className="flex items-center gap-3 text-[10px] text-slate-500 tabular-nums">
            <span className="text-emerald-400/70">Done</span>
            <span>{(lastResponseStats.elapsedMs / 1000).toFixed(1)}s</span>
            {lastResponseStats.inputTokens > 0 && (
              <span>{formatTokens(lastResponseStats.inputTokens)} in</span>
            )}
            {lastResponseStats.outputTokens > 0 && (
              <span>{formatTokens(lastResponseStats.outputTokens)} out</span>
            )}
          </div>
        </div>
      )}

      {/* Chat input — send messages to resume/continue this session */}
      {session && isTauriAvailable() && (
        <div className="shrink-0 border-t border-[#1e2231] px-3 py-2">
          <div className="flex items-end gap-2">
            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSend();
                }
              }}
              placeholder={chatSending || waitingForResponse ? "Waiting for response..." : "Continue this session... (Enter to send)"}
              disabled={chatSending || waitingForResponse}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-[13px] text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50 disabled:opacity-50 max-h-24"
              style={{ height: "auto", minHeight: "36px" }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 96) + "px";
              }}
            />
            <button
              onClick={handleChatSend}
              disabled={chatSending || !chatInput.trim()}
              className="rounded-lg bg-amber-500 px-3 py-2 text-[11px] font-medium text-white hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {chatSending ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
