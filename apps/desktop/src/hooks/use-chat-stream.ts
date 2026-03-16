import { useState, useEffect, useRef } from "react";
import { onChatStream, isTauriAvailable } from "@/lib/tauri-ipc";
import type { ChatStreamEvent } from "@/lib/tauri-ipc";

interface UseChatStreamOptions {
  onAssistantDone: (text: string, sessionId?: string) => void;
  onSystemMessage: (text: string) => void;
  onTextUpdate?: () => void;
}

interface StreamStats {
  startedAt: number | null;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Hook that subscribes to `chat-stream` Tauri events and manages
 * streaming state. Returns `{ sending, streamingText, stats }`.
 */
export function useChatStream(opts: UseChatStreamOptions) {
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [stats, setStats] = useState<StreamStats>({
    startedAt: null,
    elapsedMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref to read streaming text synchronously (avoids side-effect in state updater)
  const textRef = useRef("");

  useEffect(() => {
    if (!isTauriAvailable()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    onChatStream((event: ChatStreamEvent) => {
      const content = event.content as Record<string, unknown>;

      switch (event.event_type) {
        case "assistant": {
          const msg = content.message as Record<string, unknown> | undefined;
          if (msg?.content) {
            const blocks = msg.content as Array<{ type: string; text?: string }>;
            const text = blocks
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("");
            if (text) {
              setSending(true);
              textRef.current = text;
              setStreamingText(text);
              optsRef.current.onTextUpdate?.();
            }
          }
          const usage = (content.usage ?? (content.message as Record<string, unknown>)?.usage) as Record<string, number> | undefined;
          if (usage) {
            setStats((prev) => ({
              ...prev,
              inputTokens: prev.inputTokens + (usage.input_tokens ?? 0),
              outputTokens: prev.outputTokens + (usage.output_tokens ?? 0),
            }));
          }
          break;
        }
        case "content_block_start":
        case "message_start": {
          const now = Date.now();
          setSending(true);
          setStats({ startedAt: now, elapsedMs: 0, inputTokens: 0, outputTokens: 0 });
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            setStats((prev) => ({
              ...prev,
              elapsedMs: prev.startedAt ? Date.now() - prev.startedAt : 0,
            }));
          }, 100);
          break;
        }
        case "text_delta": {
          const text =
            (content.text as string | undefined) ??
            ((content.delta as Record<string, unknown>)?.text as string | undefined);
          if (text) {
            setSending(true);
            textRef.current += text;
            setStreamingText(textRef.current);
            optsRef.current.onTextUpdate?.();
          }
          break;
        }
        case "result": {
          const result = content.result as Record<string, unknown> | undefined;
          const usage = result?.usage as Record<string, number> | undefined;
          if (usage) {
            setStats((prev) => ({
              ...prev,
              inputTokens: prev.inputTokens + (usage.input_tokens ?? 0),
              outputTokens: prev.outputTokens + (usage.output_tokens ?? 0),
            }));
          }
          break;
        }
        case "done": {
          const sid = content.session_id as string | undefined;
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setStats((prev) => ({
            ...prev,
            elapsedMs: prev.startedAt ? Date.now() - prev.startedAt : prev.elapsedMs,
          }));
          // Read text from ref (avoids side-effect inside state updater)
          const finalText = textRef.current;
          textRef.current = "";
          setStreamingText("");
          setSending(false);
          optsRef.current.onAssistantDone(finalText, sid ?? undefined);
          break;
        }
        case "system": {
          const text = (content.message as string) ?? JSON.stringify(content);
          optsRef.current.onSystemMessage(text);
          break;
        }
      }
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return { sending, streamingText, stats };
}
