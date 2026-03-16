import { useState, useEffect, useRef } from "react";
import {
  listThreadMessages,
  sendAgentMessage,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { AgentMessage } from "@/lib/tauri-ipc";

interface DiscussionThreadProps {
  threadId: string;
  threadTitle?: string;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function DiscussionThread({
  threadId,
  threadTitle,
}: DiscussionThreadProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    loadMessages();
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, [threadId]);

  async function loadMessages() {
    try {
      const msgs = await listThreadMessages(threadId);
      setMessages(msgs);
    } catch {
      // Silently fail for polling
    }
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      await sendAgentMessage(threadId, newMessage);
      setNewMessage("");
      await loadMessages();
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full rounded-xl border border-[#1e2231] bg-[#13151c]">
      {/* Header */}
      <div className="border-b border-[#1e2231] px-4 py-3">
        <h3 className="text-xs font-semibold text-slate-300">
          {threadTitle ?? `Thread: ${threadId.slice(0, 12)}`}
        </h3>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-8">
            No messages yet. Start the conversation.
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-0.5 ${
                msg.sender_type === "human" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                  msg.sender_type === "human"
                    ? "bg-amber-500/15 text-amber-200"
                    : msg.sender_type === "agent"
                      ? "bg-[#1e2231] text-slate-300"
                      : "bg-yellow-500/10 text-yellow-200"
                }`}
              >
                {msg.content}
              </div>
              <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] text-slate-600">
                  {msg.sender_type === "human"
                    ? "You"
                    : msg.sender_agent_id
                      ? `agent:${msg.sender_agent_id.slice(0, 6)}`
                      : "system"}
                </span>
                <span className="text-[10px] text-slate-700">
                  {formatTime(msg.created_at)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[#1e2231] p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50"
          />
          <button
            onClick={handleSend}
            disabled={sending || !newMessage.trim()}
            className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
