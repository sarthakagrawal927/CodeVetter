import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import SessionCard from "@/components/session-card";
import SearchBar from "@/components/search-bar";
import ChatViewer from "@/components/chat-viewer";
import {
  listSessions,
  getSession,
  searchMessages,
  mergeSessions,
  triggerIndex,
  getIndexStats,
  onSessionUpdated,
  isTauriAvailable,
  detectRunningAgents,
  deleteSession,
} from "@/lib/tauri-ipc";
import type {
  SessionRow,
  MessageRow,
  SearchResult,
} from "@/lib/tauri-ipc";

// ─── Filter types ────────────────────────────────────────────────────────────

type AgentFilter = "all" | "claude-code" | "codex";
type TimeRange = "30d" | "90d" | "all";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Sessions() {
  const [searchParams] = useSearchParams();

  // Session list state
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [hasMoreSessions, setHasMoreSessions] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sessionOffsetRef = useRef(0);

  // Live session detection via running processes (ps aux)
  const [liveSessionIds, setLiveSessionIds] = useState<Set<string>>(new Set());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // Detect live sessions by cross-referencing running processes with session data
  // Uses ref for sessions to keep callback identity stable (avoids interval churn)
  const detectLive = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const agents = await detectRunningAgents();
      if (agents.length === 0) {
        setLiveSessionIds(new Set());
        return;
      }

      const liveIds = new Set<string>();
      const now = Date.now();
      const agentTypes = new Set(agents.map((a) => a.agent_type));

      for (const s of sessionsRef.current) {
        // Match 1: session cwd appears in a running agent's command args
        if (s.cwd) {
          for (const a of agents) {
            if (a.command.includes(s.cwd)) {
              liveIds.add(s.id);
              break;
            }
          }
        }
        if (liveIds.has(s.id)) continue;

        // Match 2: same agent type + session was active recently (within 2 min)
        if (agentTypes.has(s.agent_type)) {
          const lastMsg = s.last_message ? new Date(s.last_message).getTime() : 0;
          const mtime = s.file_mtime ? new Date(s.file_mtime).getTime() : 0;
          const latest = Math.max(lastMsg, mtime);
          if (latest > 0 && now - latest < 120_000) {
            liveIds.add(s.id);
          }
        }
      }

      setLiveSessionIds(liveIds);
    } catch {
      // Ignore — running outside Tauri or command not available
    }
  }, []);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Filter state
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("90d");

  // Selected session detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(
    null
  );
  const [selectedMessages, setSelectedMessages] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  // Keyboard-focused index (separate from selection)
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Unique project IDs for the filter dropdown
  const [projectIds, setProjectIds] = useState<
    { id: string; label: string }[]
  >([]);

  // Multi-select state for merging
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    new Set()
  );
  const [mergeMode, setMergeMode] = useState(false);
  const [showMergeForm, setShowMergeForm] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const [isMerging, setIsMerging] = useState(false);

  // Re-indexing state
  const [isReindexing, setIsReindexing] = useState(false);
  const [lastIndexedAt, setLastIndexedAt] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  // Subagent state — cached per session, fetched on demand

  // Ref to prevent duplicate fetches
  const fetchingRef = useRef(false);

  // ─── Load sessions ──────────────────────────────────────────────────────

  const SESSIONS_PAGE_SIZE = 100;

  const loadSessions = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    // Only show loading spinner on first load (not refetches) to prevent flicker
    if (sessions.length === 0) setSessionsLoading(true);
    setSessionsError(null);
    try {
      const result = await listSessions(undefined, undefined, SESSIONS_PAGE_SIZE, 0);
      setSessions(result);
      sessionOffsetRef.current = result.length;
      setHasMoreSessions(result.length >= SESSIONS_PAGE_SIZE);

      // Extract unique project IDs for the filter
      const projectMap = new Map<string, string>();
      for (const s of result) {
        if (!projectMap.has(s.project_id)) {
          const label = s.cwd
            ? s.cwd.split("/").filter(Boolean).slice(-2).join("/")
            : s.project_id.slice(0, 8);
          projectMap.set(s.project_id, label);
        }
      }
      setProjectIds(
        Array.from(projectMap.entries()).map(([id, label]) => ({ id, label }))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "TAURI_NOT_AVAILABLE") {
        setSessionsError(
          "Tauri APIs not available. Run inside the desktop app."
        );
      } else {
        setSessionsError(msg);
      }
    } finally {
      setSessionsLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  const loadMoreSessions = useCallback(async () => {
    if (fetchingRef.current || !hasMoreSessions) return;
    fetchingRef.current = true;
    setLoadingMore(true);
    try {
      const result = await listSessions(undefined, undefined, SESSIONS_PAGE_SIZE, sessionOffsetRef.current);
      setSessions((prev) => [...prev, ...result]);
      sessionOffsetRef.current += result.length;
      setHasMoreSessions(result.length >= SESSIONS_PAGE_SIZE);
    } catch (err) {
      console.error("Failed to load more sessions:", err);
    } finally {
      setLoadingMore(false);
      fetchingRef.current = false;
    }
  }, [hasMoreSessions]);

  // Load last index time
  const loadMeta = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const stats = await getIndexStats();
      setLastIndexedAt(stats.last_indexed_at);
    } catch {
      // ignore
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadSessions();
    loadMeta();
  }, [loadSessions, loadMeta]);

  // Detect live sessions on mount and every 10 seconds
  useEffect(() => {
    detectLive();
    const interval = setInterval(detectLive, 10_000);
    return () => clearInterval(interval);
  }, [detectLive]);

  // Auto-select session from URL query param (?id=...)
  useEffect(() => {
    const idFromUrl = searchParams.get("id");
    if (idFromUrl && !selectedId) {
      setSelectedId(idFromUrl);
    }
  }, [searchParams, selectedId]);

  // ─── Listen for live session updates ────────────────────────────────────

  useEffect(() => {
    if (!isTauriAvailable()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    onSessionUpdated(() => {
      loadSessions();
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadSessions]);

  // ─── Handle search ─────────────────────────────────────────────────────

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchMessages(query);
      setSearchResults(results);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearchResultClick = useCallback(
    (result: SearchResult) => {
      setSelectedId(result.session_id);
      setSearchQuery("");
      setSearchResults([]);
    },
    []
  );

  // ─── Multi-select toggle ────────────────────────────────────────────────

  const toggleSessionSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const handleCancelMerge = useCallback(() => {
    setMergeMode(false);
    setSelectedSessionIds(new Set());
    setShowMergeForm(false);
    setMergeName("");
  }, []);

  const handleMerge = useCallback(async () => {
    if (selectedSessionIds.size < 2) return;

    const ids = Array.from(selectedSessionIds);
    const firstSelected = sessions.find((s) => s.id === ids[0]);
    if (!firstSelected) return;

    setIsMerging(true);
    try {
      await mergeSessions(
        ids,
        firstSelected.project_id,
        mergeName.trim() || undefined
      );
      handleCancelMerge();
      loadSessions();
    } catch (err) {
      console.error("Merge failed:", err);
    } finally {
      setIsMerging(false);
    }
  }, [selectedSessionIds, sessions, mergeName, handleCancelMerge, loadSessions]);

  // ─── Subagent expand/collapse ───────────────────────────────────────

  // ─── Load session detail when selection changes ────────────────────────

  useEffect(() => {
    if (!selectedId) {
      setSelectedSession(null);
      setSelectedMessages([]);
      setMessagesError(null);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);

    (async () => {
      try {
        const result = await getSession(selectedId);
        if (cancelled) return;
        setSelectedSession(result.session);
        setSelectedMessages(result.messages);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Failed to load session:", msg);
        setMessagesError(msg);
        setSelectedSession(null);
        setSelectedMessages([]);
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ─── Pagination ────────────────────────────────────────────────────────

  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Filtered sessions ─────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const list = sessions.filter((s) => {
      if (s.message_count === 0) return false;
      // Skip probe/health-check/CLI test sessions
      if (s.cwd) {
        const projectName = s.cwd.split("/").pop()?.toLowerCase() ?? "";
        if (
          projectName.includes("probe") ||
          projectName.includes("claudeprobe") ||
          projectName.includes("chatcli")
        ) return false;
      }
      if (agentFilter !== "all" && s.agent_type !== agentFilter) return false;
      if (projectFilter !== "all" && s.project_id !== projectFilter)
        return false;
      if (timeRange !== "all" && s.last_message) {
        const sessionDate = new Date(s.last_message).getTime();
        const now = Date.now();
        const days = timeRange === "30d" ? 30 : 90;
        if (now - sessionDate > days * 24 * 60 * 60 * 1000) return false;
      }
      if (searchQuery && !isSearching) {
        const q = searchQuery.toLowerCase();
        const matchesCwd = s.cwd?.toLowerCase().includes(q);
        const matchesBranch = s.git_branch?.toLowerCase().includes(q);
        if (!matchesCwd && !matchesBranch) return false;
      }
      return true;
    });

    // Pin live sessions at the top
    if (liveSessionIds.size > 0) {
      list.sort((a, b) => {
        const aLive = liveSessionIds.has(a.id) ? 1 : 0;
        const bLive = liveSessionIds.has(b.id) ? 1 : 0;
        if (aLive !== bLive) return bLive - aLive; // live first
        return 0; // preserve existing sort (by last_message DESC from backend)
      });
    }

    return list;
  }, [
    sessions,
    agentFilter,
    projectFilter,
    timeRange,
    searchQuery,
    isSearching,
    liveSessionIds,
  ]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setFocusedIndex(-1);
  }, [agentFilter, projectFilter, timeRange, searchQuery]);

  const visibleSessions = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMore = visibleCount < filtered.length;

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
    }
  }, [hasMore, filtered.length]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // "/" to focus search (only when not in an input)
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        // Find the search input inside SearchBar
        const searchEl = document.querySelector<HTMLInputElement>(
          '[data-search-input]'
        );
        searchEl?.focus();
        return;
      }

      // Escape: blur search or close chat viewer
      if (e.key === "Escape") {
        if (isInput) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (selectedId) {
          setSelectedId(null);
          return;
        }
      }

      // j/k navigation (only when not in input)
      if (!isInput) {
        if (e.key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.min(prev + 1, visibleSessions.length - 1);
            // Scroll the focused item into view
            const el = document.querySelector(`[data-session-index="${next}"]`);
            el?.scrollIntoView({ block: "nearest" });
            return next;
          });
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            const el = document.querySelector(`[data-session-index="${next}"]`);
            el?.scrollIntoView({ block: "nearest" });
            return next;
          });
          return;
        }

        // Enter to select focused
        if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < visibleSessions.length) {
          e.preventDefault();
          const s = visibleSessions[focusedIndex];
          if (mergeMode) {
            toggleSessionSelection(s.id);
          } else {
            setSelectedId(s.id);
          }
          return;
        }

        // x to toggle selection in merge mode
        if (e.key === "x" && mergeMode && focusedIndex >= 0 && focusedIndex < visibleSessions.length) {
          e.preventDefault();
          toggleSessionSelection(visibleSessions[focusedIndex].id);
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, focusedIndex, visibleSessions, mergeMode, toggleSessionSelection]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* Left panel: session list */}
      <div className="flex w-[400px] shrink-0 flex-col border-r border-[#1e2231]">
        {/* Header */}
        <div className="flex flex-col gap-2 border-b border-[#1e2231] px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-slate-100">History</h1>
              {!sessionsLoading && (
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {filtered.length}
                  {lastIndexedAt && (
                    <span className="ml-1 text-slate-600">
                      {"\u00B7"} {formatRelativeTime(lastIndexedAt)}
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="relative flex items-center gap-1.5">
              {mergeMode && (
                <button
                  onClick={handleCancelMerge}
                  className="rounded px-2 py-1 text-[11px] font-medium bg-amber-500/10 text-amber-400 transition-colors"
                >
                  Cancel merge
                </button>
              )}
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="rounded p-1 text-slate-500 hover:text-slate-300 hover:bg-[#1a1d27] transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="3" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="13" r="1.5" />
                </svg>
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-[#1e2231] bg-[#13151c] py-1 shadow-xl">
                    <button
                      onClick={async () => {
                        setShowMenu(false);
                        if (isReindexing) return;
                        setIsReindexing(true);
                        try {
                          await triggerIndex();
                          await Promise.all([loadSessions(), loadMeta()]);
                        } catch (err) {
                          console.error("Re-index failed:", err);
                        } finally {
                          setIsReindexing(false);
                        }
                      }}
                      disabled={isReindexing}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-[#1a1d27] transition-colors disabled:opacity-50 text-left"
                    >
                      {isReindexing ? "Indexing..." : "Re-index"}
                    </button>
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        setMergeMode(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-[#1a1d27] transition-colors text-left"
                    >
                      Merge sessions
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <SearchBar
            placeholder="Search messages..."
            onSearch={handleSearch}
            isSearching={isSearching}
            searchResults={searchResults}
            onResultClick={handleSearchResultClick}
          />

          {/* Filters row */}
          <div className="flex items-center gap-1 flex-wrap text-[11px]">
            {(["all", "claude-code", "codex"] as AgentFilter[]).map(
              (filter) => (
                <button
                  key={filter}
                  onClick={() => setAgentFilter(filter)}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    agentFilter === filter
                      ? "bg-[#1e2231] text-slate-200"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {filter === "all"
                    ? "All"
                    : filter === "claude-code"
                    ? "Claude"
                    : "Codex"}
                </button>
              )
            )}

            <span className="mx-1 h-3 w-px bg-[#1e2231]" />

            {(["30d", "90d", "all"] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  timeRange === range
                    ? "bg-[#1e2231] text-slate-200"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {range === "all" ? "All time" : range}
              </button>
            ))}

            {projectIds.length > 1 && (
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="ml-auto max-w-[120px] truncate rounded bg-transparent px-1 py-0.5 text-[11px] text-slate-500 outline-none hover:text-slate-300"
              >
                <option value="all">All projects</option>
                {projectIds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-3 border-b border-[#1e2231] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">
          <span className="w-2" />
          <span className="min-w-0 max-w-[140px]">Project</span>
          <span>Branch</span>
          <span className="flex-1" />
          <span>Tokens</span>
          <span className="w-[28px] text-right">Age</span>
        </div>

        {/* Session list */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
        >
          {sessionsLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <svg
                className="h-4 w-4 animate-spin text-slate-500 mb-2"
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
              <p className="text-[11px] text-slate-600">Loading...</p>
            </div>
          ) : sessionsError ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <p className="text-xs text-red-400 text-center">
                {sessionsError}
              </p>
              <button
                onClick={loadSessions}
                className="mt-2 text-[11px] text-slate-500 hover:text-slate-300"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-slate-600">
              No sessions found
            </p>
          ) : (
            <div className="flex flex-col">
              {visibleSessions.map((session, i) => {
                return (
                  <div key={session.id}>
                    <div
                      data-session-index={i}
                      className={`group flex items-center border-b border-[#1e2231]/50 ${
                        mergeMode && selectedSessionIds.has(session.id)
                          ? "bg-amber-500/5"
                          : ""
                      }`}
                    >
                      {mergeMode && (
                        <label className="flex items-center justify-center pl-2 shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedSessionIds.has(session.id)}
                            onChange={() => toggleSessionSelection(session.id)}
                            className="h-3.5 w-3.5 rounded border-slate-600 bg-transparent accent-amber-500 cursor-pointer"
                          />
                        </label>
                      )}
                      <div className="flex-1 min-w-0">
                        <SessionCard
                          session={session}
                          selected={selectedId === session.id}
                          focused={focusedIndex === i && !selectedId}
                          isLive={liveSessionIds.has(session.id)}
                          onClick={() => {
                            if (mergeMode) {
                              toggleSessionSelection(session.id);
                            } else {
                              setSelectedId(session.id);
                              setFocusedIndex(i);
                            }
                          }}
                        />
                      </div>
                      {!mergeMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSession(session.id).then(() => {
                              setSessions((prev) => prev.filter((s) => s.id !== session.id));
                              if (selectedId === session.id) {
                                setSelectedId(null);
                                setSelectedSession(null);
                                setSelectedMessages([]);
                              }
                            });
                          }}
                          className="shrink-0 p-1.5 rounded text-slate-700 hover:text-slate-400 opacity-0 group-hover:opacity-100"
                          title="Delete session"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {hasMore && (
                <p className="py-2 text-center text-[10px] text-slate-600">
                  Showing {visibleCount} of {sessions.length} sessions
                </p>
              )}
              {hasMoreSessions && (
                <button
                  onClick={loadMoreSessions}
                  disabled={loadingMore}
                  className="w-full py-2 text-center text-[11px] text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? "Loading..." : "Load more sessions"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Floating merge action bar */}
        {mergeMode && selectedSessionIds.size >= 2 && (
          <div className="border-t border-[#1e2231] bg-[#13151c] p-2">
            {!showMergeForm ? (
              <button
                onClick={() => setShowMergeForm(true)}
                className="w-full rounded px-3 py-2 text-[12px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/15 transition-colors"
              >
                Merge {selectedSessionIds.size} sessions
              </button>
            ) : (
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={mergeName}
                  onChange={(e) => setMergeName(e.target.value)}
                  className="w-full rounded border border-[#1e2231] bg-[#0f1117] px-2.5 py-1.5 text-[12px] text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleMerge();
                    if (e.key === "Escape") setShowMergeForm(false);
                  }}
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleMerge}
                    disabled={isMerging}
                    className="flex-1 rounded bg-amber-500/10 px-3 py-1.5 text-[12px] font-medium text-amber-400 hover:bg-amber-500/15 transition-colors disabled:opacity-50"
                  >
                    {isMerging ? "Merging..." : "Confirm"}
                  </button>
                  <button
                    onClick={() => setShowMergeForm(false)}
                    className="rounded bg-[#1e2231] px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right panel: chat viewer */}
      <div className="flex-1 relative">
        {selectedId && messagesError ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-600 px-8">
            <p className="text-xs text-red-400 mb-1">Failed to load session</p>
            <p className="text-[11px] text-slate-500 text-center mb-3 max-w-md">
              {messagesError}
            </p>
            <button
              onClick={() => {
                const id = selectedId;
                setSelectedId(null);
                setTimeout(() => setSelectedId(id), 50);
              }}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              Retry
            </button>
          </div>
        ) : selectedId ? (
          <ChatViewer
            messages={selectedMessages}
            session={selectedSession ?? undefined}
            isLoading={messagesLoading}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-slate-600">
            <p className="text-[13px] text-slate-500">Select a session</p>
            <p className="text-[11px] text-slate-600 mt-1">
              <kbd className="rounded bg-[#1e2231] px-1.5 py-0.5 text-[10px] font-mono text-slate-500">j</kbd>
              {" / "}
              <kbd className="rounded bg-[#1e2231] px-1.5 py-0.5 text-[10px] font-mono text-slate-500">k</kbd>
              {" to navigate, "}
              <kbd className="rounded bg-[#1e2231] px-1.5 py-0.5 text-[10px] font-mono text-slate-500">/</kbd>
              {" to search"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
