import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  sendChatMessage,
  getSession,
  isTauriAvailable,
  pickDirectory,
  listChatTabs,
  createChatTab,
  updateChatTab,
  deleteChatTab,
} from "@/lib/tauri-ipc";
import type { ChatTab } from "@/lib/tauri-ipc";
import { useChatStream } from "@/hooks/use-chat-stream";
import type { RateLimitEventInfo } from "@/hooks/use-chat-stream";
import ContextMeter from "@/components/context-meter";
import CapacityIndicator from "@/components/capacity-indicator";
import type { RateLimitInfo } from "@/components/capacity-indicator";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

type ChatState = "idle" | "waiting" | "streaming";

/** Maximum messages kept in memory per tab. Older messages are discarded. */
const MAX_MESSAGES_IN_MEMORY = 200;

interface TabState {
  messages: ChatMessage[];
  /** Total message count including truncated older messages. */
  totalMessageCount: number;
  sessionId: string | undefined;
  projectPath: string | undefined;
  model: string;
  chatState: ChatState;
  input: string;
  loadingHistory: boolean;
}

/** Enforce the message window limit, keeping the most recent messages. */
function windowMessages(messages: ChatMessage[], totalCount: number): { messages: ChatMessage[]; totalMessageCount: number } {
  if (messages.length <= MAX_MESSAGES_IN_MEMORY) {
    return { messages, totalMessageCount: Math.max(totalCount, messages.length) };
  }
  return {
    messages: messages.slice(-MAX_MESSAGES_IN_MEMORY),
    totalMessageCount: Math.max(totalCount, messages.length),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function convertSessionMessages(
  msgs: { role: string | null; content_text: string | null }[]
): ChatMessage[] {
  return msgs
    .filter((m) => m.content_text?.trim())
    .filter((m) => m.role === "user" || m.role === "human" || m.role === "assistant")
    .map((m) => ({
      role: (m.role === "human" ? "user" : m.role) as "user" | "assistant",
      content: m.content_text!,
    }));
}

function makeDefaultTabState(projectPath?: string, model?: string): TabState {
  return {
    messages: [],
    totalMessageCount: 0,
    sessionId: undefined,
    projectPath,
    model: model ?? "sonnet",
    chatState: "idle",
    input: "",
    loadingHistory: false,
  };
}

// ─── Message bubble components ──────────────────────────────────────────────

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] rounded-lg bg-amber-500/15 px-4 py-3">
        <p className="text-[13px] text-slate-200 whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="mb-4 max-w-[90%]">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
          Claude
        </span>
      </div>
      <div className="rounded-lg bg-[#161922] border border-[#1e2231] px-4 py-3">
        <p className="text-[13px] text-slate-300 whitespace-pre-wrap leading-relaxed">
          {content}
        </p>
      </div>
    </div>
  );
}

function SystemBubble({ content }: { content: string }) {
  return (
    <div className="mb-4">
      <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2">
        <p className="text-[12px] text-amber-300/80 whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function PendingBubble({ state, text }: { state: "waiting" | "streaming"; text: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
          Claude
        </span>
      </div>
      <div className="rounded-lg bg-[#161922] border border-[#1e2231] px-4 py-3">
        {state === "streaming" && text ? (
          <p className="text-[13px] text-slate-300 whitespace-pre-wrap leading-relaxed">
            {text}
            <span className="inline-block w-1.5 h-4 bg-amber-400/50 animate-pulse ml-0.5 align-text-bottom" />
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-[pulse_1s_ease-in-out_infinite]" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" style={{ animation: "pulse 1s ease-in-out infinite 200ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" style={{ animation: "pulse 1s ease-in-out infinite 400ms" }} />
            </div>
            <span className="text-[12px] text-slate-500">
              {state === "waiting" ? "Connecting..." : "Thinking..."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Scroll hook ─────────────────────────────────────────────────────────────

function useScrollToBottom(
  containerRef: React.RefObject<HTMLDivElement | null>,
  deps: unknown[]
) {
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, deps);
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Chat() {
  const [searchParams, setSearchParams] = useSearchParams();
  const resumeSessionId = searchParams.get("session") ?? undefined;
  const initialProject = searchParams.get("project") ?? undefined;

  // ─── Tab state ──────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});
  const [tabsLoaded, setTabsLoaded] = useState(false);

  // Rate limit info from stream events
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);

  // Track which tab initiated the current stream so events route correctly
  const streamingTabIdRef = useRef<string | null>(null);
  // Track which sessions have already been loaded to avoid re-fetching
  const loadedSessionsRef = useRef<Set<string>>(new Set());

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ─── Active tab state accessors ────────────────────────────────────────
  const _activeTab = tabs.find((t) => t.id === activeTabId);
  const activeState = activeTabId ? tabStates[activeTabId] : undefined;

  const updateActiveState = useCallback(
    (updater: (prev: TabState) => TabState) => {
      if (!activeTabId) return;
      setTabStates((prev) => {
        const current = prev[activeTabId] ?? makeDefaultTabState();
        return { ...prev, [activeTabId]: updater(current) };
      });
    },
    [activeTabId]
  );

  const updateTabState = useCallback(
    (tabId: string, updater: (prev: TabState) => TabState) => {
      setTabStates((prev) => {
        const current = prev[tabId] ?? makeDefaultTabState();
        return { ...prev, [tabId]: updater(current) };
      });
    },
    []
  );

  // ─── Stream handler ─────────────────────────────────────────────────────

  const { sending, streamingText, stats } = useChatStream({
    onAssistantDone(text, newSessionId) {
      const targetTabId = streamingTabIdRef.current;
      if (!targetTabId) return;

      updateTabState(targetTabId, (prev) => {
        const newMessages = text.trim()
          ? [...prev.messages, { role: "assistant" as const, content: text }]
          : prev.messages;
        const { messages, totalMessageCount } = windowMessages(newMessages, prev.totalMessageCount + (text.trim() ? 1 : 0));
        return {
          ...prev,
          chatState: "idle",
          messages,
          totalMessageCount,
          sessionId: newSessionId ?? prev.sessionId,
        };
      });

      // Persist the session_id to the tab in the database
      if (newSessionId) {
        updateChatTab(targetTabId, { session_id: newSessionId }).catch(() => {});
        // Also update the tabs array to reflect the session_id
        setTabs((prev) =>
          prev.map((t) =>
            t.id === targetTabId ? { ...t, session_id: newSessionId } : t
          )
        );
      }

      streamingTabIdRef.current = null;
      inputRef.current?.focus();
    },
    onSystemMessage(text) {
      const targetTabId = streamingTabIdRef.current ?? activeTabId;
      if (!targetTabId) return;
      updateTabState(targetTabId, (prev) => {
        const newMessages = [...prev.messages, { role: "system" as const, content: text }];
        const { messages, totalMessageCount } = windowMessages(newMessages, prev.totalMessageCount + 1);
        return { ...prev, chatState: "idle", messages, totalMessageCount };
      });
      streamingTabIdRef.current = null;
    },
    onTextUpdate() {
      const targetTabId = streamingTabIdRef.current;
      if (!targetTabId) return;
      updateTabState(targetTabId, (prev) =>
        prev.chatState !== "streaming" ? { ...prev, chatState: "streaming" } : prev
      );
    },
    onRateLimitUpdate(info: RateLimitEventInfo) {
      setRateLimitInfo(info);
    },
  });

  // Sync stream hook's sending state
  useEffect(() => {
    const targetTabId = streamingTabIdRef.current;
    if (sending && targetTabId) {
      updateTabState(targetTabId, (prev) =>
        prev.chatState === "waiting" ? { ...prev, chatState: "streaming" } : prev
      );
    }
  }, [sending, updateTabState]);

  // ─── Load tabs on mount ────────────────────────────────────────────────

  useEffect(() => {
    if (!isTauriAvailable()) {
      setTabsLoaded(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { tabs: existingTabs } = await listChatTabs();

        if (cancelled) return;

        if (existingTabs.length > 0) {
          setTabs(existingTabs);

          // Initialize tab states
          const states: Record<string, TabState> = {};
          for (const tab of existingTabs) {
            states[tab.id] = makeDefaultTabState(tab.project_path ?? undefined, tab.model);
            states[tab.id].sessionId = tab.session_id ?? undefined;
          }

          // If there's a resume session, find matching tab or use first
          if (resumeSessionId) {
            const matchingTab = existingTabs.find(
              (t) => t.session_id === resumeSessionId
            );
            if (matchingTab) {
              setActiveTabId(matchingTab.id);
              states[matchingTab.id].loadingHistory = true;
            } else {
              // Create a new tab for this session
              const newTab = await createChatTab("Resumed session", initialProject);
              const newState = makeDefaultTabState(initialProject);
              newState.sessionId = resumeSessionId;
              newState.loadingHistory = true;
              states[newTab.id] = newState;
              setTabs((prev) => [...prev, newTab]);
              setActiveTabId(newTab.id);
            }
          } else {
            setActiveTabId(existingTabs[0].id);
          }

          setTabStates(states);
        } else {
          // No tabs exist — create a default one
          const newTab = await createChatTab("Untitled", initialProject);
          if (cancelled) return;
          setTabs([newTab]);
          setActiveTabId(newTab.id);
          setTabStates({
            [newTab.id]: makeDefaultTabState(
              initialProject ?? newTab.project_path ?? undefined,
              newTab.model
            ),
          });
        }
      } catch (err) {
        console.error("Failed to load chat tabs:", err);
        // Fallback: create an in-memory tab
        const fallbackId = crypto.randomUUID();
        setTabs([
          {
            id: fallbackId,
            title: "Untitled",
            session_id: null,
            project_path: null,
            model: "sonnet",
            position: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
        setActiveTabId(fallbackId);
        setTabStates({ [fallbackId]: makeDefaultTabState(initialProject) });
      } finally {
        if (!cancelled) setTabsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Load session history when switching to a tab with a session ──────

  useEffect(() => {
    if (!activeTabId || !tabsLoaded || !isTauriAvailable()) return;

    // Read the session ID from the tab's state
    const state = tabStates[activeTabId];
    if (!state) return;
    const sessionToLoad = state.sessionId;
    if (!sessionToLoad) return;

    // Skip if we already loaded this session for this tab
    const loadKey = `${activeTabId}:${sessionToLoad}`;
    if (loadedSessionsRef.current.has(loadKey)) return;
    loadedSessionsRef.current.add(loadKey);

    let cancelled = false;
    updateTabState(activeTabId, (prev) => ({ ...prev, loadingHistory: true }));

    (async () => {
      try {
        const { session, messages: msgs } = await getSession(sessionToLoad);
        if (cancelled) return;
        updateTabState(activeTabId, (prev) => {
          const allMessages = convertSessionMessages(msgs);
          const { messages, totalMessageCount } = windowMessages(allMessages, allMessages.length);
          return {
            ...prev,
            messages,
            totalMessageCount,
            projectPath: prev.projectPath ?? session.cwd ?? undefined,
            loadingHistory: false,
          };
        });
      } catch (err) {
        console.error("Failed to load session history:", err);
        if (!cancelled) {
          updateTabState(activeTabId, (prev) => ({ ...prev, loadingHistory: false }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTabId, tabsLoaded]);

  // ─── Auto-scroll ──────────────────────────────────────────────────────

  useScrollToBottom(scrollContainerRef, [
    activeState?.messages.length,
    streamingText,
    activeState?.loadingHistory,
    activeState?.chatState,
  ]);

  // ─── Tab operations ───────────────────────────────────────────────────

  const handleNewTab = useCallback(async () => {
    try {
      const newTab = await createChatTab();
      setTabs((prev) => [...prev, newTab]);
      setTabStates((prev) => ({
        ...prev,
        [newTab.id]: makeDefaultTabState(),
      }));
      setActiveTabId(newTab.id);
      inputRef.current?.focus();
    } catch (err) {
      console.error("Failed to create tab:", err);
    }
  }, []);

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      // If closing the last tab, create a new one first
      if (tabs.length <= 1) {
        try {
          const newTab = await createChatTab();
          setTabs([newTab]);
          setTabStates({ [newTab.id]: makeDefaultTabState() });
          setActiveTabId(newTab.id);
        } catch (err) {
          console.error("Failed to create replacement tab:", err);
          return;
        }
      } else {
        const idx = tabs.findIndex((t) => t.id === tabId);
        const newTabs = tabs.filter((t) => t.id !== tabId);
        setTabs(newTabs);

        if (activeTabId === tabId) {
          // Switch to adjacent tab
          const newIdx = Math.min(idx, newTabs.length - 1);
          setActiveTabId(newTabs[newIdx].id);
        }

        setTabStates((prev) => {
          const next = { ...prev };
          delete next[tabId];
          return next;
        });
      }

      // Delete from database
      try {
        await deleteChatTab(tabId);
      } catch (err) {
        console.error("Failed to delete tab:", err);
      }
    },
    [tabs, activeTabId]
  );

  const handleSwitchTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) return;
      setActiveTabId(tabId);
      // Clear URL params when switching tabs
      setSearchParams({}, { replace: true });
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [activeTabId, setSearchParams]
  );

  // ─── Keyboard shortcuts ────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+T — new tab
      if (meta && e.key === "t") {
        e.preventDefault();
        handleNewTab();
        return;
      }

      // Cmd+W — close current tab
      if (meta && e.key === "w") {
        e.preventDefault();
        if (activeTabId) handleCloseTab(activeTabId);
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (tabs.length < 2 || !activeTabId) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (e.shiftKey) {
          const prev = (idx - 1 + tabs.length) % tabs.length;
          handleSwitchTab(tabs[prev].id);
        } else {
          const next = (idx + 1) % tabs.length;
          handleSwitchTab(tabs[next].id);
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNewTab, handleCloseTab, handleSwitchTab, activeTabId, tabs]);

  // ─── Send message ─────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!activeTabId || !activeState) return;
    const msg = activeState.input.trim();
    if (!msg || activeState.chatState !== "idle") return;

    // Auto-title: if this is the first message in the tab, set the title
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab && activeState.messages.length === 0 && tab.title === "Untitled") {
      const autoTitle = msg.slice(0, 40) + (msg.length > 40 ? "..." : "");
      updateChatTab(activeTabId, { title: autoTitle }).catch(() => {});
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, title: autoTitle } : t))
      );
    }

    updateActiveState((prev) => {
      const newMessages = [...prev.messages, { role: "user" as const, content: msg }];
      const { messages, totalMessageCount } = windowMessages(newMessages, prev.totalMessageCount + 1);
      return { ...prev, input: "", messages, totalMessageCount, chatState: "waiting" };
    });

    // Track which tab is streaming
    streamingTabIdRef.current = activeTabId;

    try {
      await sendChatMessage(
        msg,
        activeState.sessionId,
        activeState.projectPath,
        activeState.model
      );
    } catch (err) {
      streamingTabIdRef.current = null;
      updateActiveState((prev) => {
        const newMessages = [
          ...prev.messages,
          {
            role: "system" as const,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ];
        const { messages, totalMessageCount } = windowMessages(newMessages, prev.totalMessageCount + 1);
        return { ...prev, chatState: "idle", messages, totalMessageCount };
      });
    }
  }, [activeTabId, activeState, tabs, updateActiveState]);

  // ─── Model / project changes ──────────────────────────────────────────

  const handleModelChange = useCallback(
    (newModel: string) => {
      if (!activeTabId) return;
      updateActiveState((prev) => ({ ...prev, model: newModel }));
      updateChatTab(activeTabId, { model: newModel }).catch(() => {});
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, model: newModel } : t))
      );
    },
    [activeTabId, updateActiveState]
  );

  const handleProjectPick = useCallback(async () => {
    const dir = await pickDirectory("Select project directory");
    if (dir && activeTabId) {
      updateActiveState((prev) => ({ ...prev, projectPath: dir }));
      updateChatTab(activeTabId, { project_path: dir }).catch(() => {});
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, project_path: dir } : t))
      );
    }
  }, [activeTabId, updateActiveState]);

  // ─── Derived values ───────────────────────────────────────────────────

  const isBusy = activeState?.chatState !== "idle";
  const messages = activeState?.messages ?? [];
  const input = activeState?.input ?? "";
  const loadingHistory = activeState?.loadingHistory ?? false;
  const chatState = activeState?.chatState ?? "idle";

  if (!tabsLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#1e2231] px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-100">Chat</h1>

        <span className="flex-1" />

        <select
          value={activeState?.model ?? "sonnet"}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={isBusy}
          className="rounded border border-[#1e2231] bg-[#0f1117] px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-amber-500/50"
        >
          <option value="sonnet">Sonnet</option>
          <option value="opus">Opus</option>
          <option value="haiku">Haiku</option>
        </select>

        <button
          onClick={handleProjectPick}
          className="rounded border border-[#1e2231] bg-[#0f1117] px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
          title={activeState?.projectPath ?? "No project selected"}
        >
          {activeState?.projectPath
            ? activeState.projectPath.split("/").pop()
            : "Select project"}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-stretch border-b border-[#1e2231] bg-[#0e0f13] overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleSwitchTab(tab.id)}
            className={`group flex items-center px-3 py-2 text-[12px] border-r border-[#1e2231] shrink-0 transition-colors ${
              tab.id === activeTabId
                ? "bg-[#13151c] text-slate-200 border-b-2 border-b-amber-400"
                : "bg-[#0e0f13] text-slate-500 hover:text-slate-300 border-b-2 border-b-transparent"
            }`}
          >
            <span className="truncate max-w-[120px]">{tab.title}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                handleCloseTab(tab.id);
              }}
              className="ml-2 text-slate-600 hover:text-slate-300 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
            >
              x
            </span>
          </button>
        ))}
        <button
          onClick={handleNewTab}
          className="px-3 text-slate-600 hover:text-slate-300 text-[14px] shrink-0 transition-colors"
          title="New tab (Cmd+T)"
        >
          +
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loadingHistory ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <span className="text-[12px] text-slate-500">Loading session history...</span>
          </div>
        ) : messages.length === 0 && chatState === "idle" ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="text-slate-600 text-[13px] text-center max-w-md">
              <p className="text-slate-400 font-medium mb-2">Start a conversation with Claude</p>
              <p>
                Messages are sent via Claude Code CLI. Select a project directory
                to give Claude context about your codebase.
              </p>
            </div>
          </div>
        ) : (
          <>
            {(activeState?.totalMessageCount ?? 0) > messages.length && (
              <div className="text-center py-2 mb-2">
                <span className="text-[11px] text-slate-600">
                  {(activeState?.totalMessageCount ?? 0) - messages.length} earlier messages not shown
                </span>
              </div>
            )}
            {messages.map((msg, i) =>
              msg.role === "system" ? null :
              msg.role === "user" ? (
                <UserBubble key={i} content={msg.content} />
              ) : (
                <AssistantBubble key={i} content={msg.content} />
              )
            )}

            {chatState !== "idle" && (
              <PendingBubble state={chatState} text={streamingText} />
            )}
          </>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#1e2231] px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) =>
              updateActiveState((prev) => ({ ...prev, input: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={isBusy ? "Waiting for response..." : "Send a message... (Enter to send)"}
            disabled={isBusy}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[#1e2231] bg-[#0f1117] px-4 py-2.5 text-[13px] text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50 disabled:opacity-50 max-h-32"
            style={{ height: "auto", minHeight: "40px" }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 128) + "px";
            }}
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={isBusy || !input.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2.5 text-[12px] font-medium text-white hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isBusy ? "..." : "Send"}
          </button>
        </div>
        {/* Context meter + Capacity indicator */}
        <div className="flex items-center justify-between mt-1.5">
          <CapacityIndicator rateLimitInfo={rateLimitInfo} />
          <ContextMeter
            inputTokens={stats.inputTokens}
            outputTokens={stats.outputTokens}
          />
        </div>
      </div>
    </div>
  );
}
