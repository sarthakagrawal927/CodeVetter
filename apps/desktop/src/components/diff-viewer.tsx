import { useState, useCallback, useRef } from "react";
import type { DiffComment } from "@/lib/tauri-ipc";

// ─── Types ─────────────────────────────────────────────────────────────────

interface DiffLine {
  type: "add" | "remove" | "context" | "hunk-header";
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
  /** Unique index within the parsed diff, used for comment placement. */
  index: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffViewerProps {
  diff: string;
  filePath: string;
  workspaceId: string;
  comments: DiffComment[];
  onCommentCreate: (startLine: number, endLine: number, content: string) => void;
  onCommentDelete: (id: string) => void;
}

// ─── Diff Parser ───────────────────────────────────────────────────────────

function parseDiff(raw: string): DiffHunk[] {
  const lines = raw.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let lineIndex = 0;

  for (const line of lines) {
    // Skip diff metadata lines (diff --git, index, ---, +++)
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("\\")
    ) {
      continue;
    }

    // Hunk header: @@ -a,b +c,d @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      currentHunk = {
        header: line,
        lines: [
          {
            type: "hunk-header",
            content: line,
            oldLineNum: null,
            newLineNum: null,
            index: lineIndex++,
          },
        ],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        oldLineNum: null,
        newLineNum: newLine,
        index: lineIndex++,
      });
      newLine++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "remove",
        content: line.slice(1),
        oldLineNum: oldLine,
        newLineNum: null,
        index: lineIndex++,
      });
      oldLine++;
    } else {
      // Context line (starts with space or is empty)
      currentHunk.lines.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldLineNum: oldLine,
        newLineNum: newLine,
        index: lineIndex++,
      });
      oldLine++;
      newLine++;
    }
  }

  return hunks;
}

// ─── Inline Comment Form ──────────────────────────────────────────────────

function InlineCommentForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
  }, [text, onSubmit]);

  return (
    <div className="border-l-2 border-amber-400 bg-[#0a0a0a] rounded-r-lg p-3 my-1 mx-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment..."
        autoFocus
        className="w-full bg-[#0a0b0f] border border-[#1a1a1a] rounded-md p-2 text-[12px] text-slate-300 font-mono resize-none focus:outline-none focus:border-amber-500/40 placeholder:text-slate-600"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-slate-600">
          {"\u2318"}+Enter to save, Esc to cancel
        </span>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="px-3 py-1 text-[10px] font-medium rounded bg-amber-500 text-black hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Comment Card ─────────────────────────────────────────────────────────

function CommentCard({
  comment,
  onDelete,
}: {
  comment: DiffComment;
  onDelete: (id: string) => void;
}) {
  const time = (() => {
    try {
      const d = new Date(comment.created_at);
      const now = Date.now();
      const diffMs = now - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      return `${diffDay}d ago`;
    } catch {
      return "";
    }
  })();

  const statusBadge =
    comment.status === "resolved" ? (
      <span className="text-[9px] rounded-full bg-emerald-500/20 px-1.5 text-emerald-400">
        resolved
      </span>
    ) : comment.status === "posted" ? (
      <span className="text-[9px] rounded-full bg-blue-500/20 px-1.5 text-blue-400">
        posted
      </span>
    ) : null;

  return (
    <div className="border-l-2 border-amber-400 bg-[#0a0a0a] rounded-r-lg p-3 my-1 mx-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-amber-400">
            {comment.author}
          </span>
          <span className="text-[9px] text-slate-600">{time}</span>
          {statusBadge}
          <span className="text-[9px] text-slate-700">
            L{comment.start_line}
            {comment.end_line !== comment.start_line && `-${comment.end_line}`}
          </span>
        </div>
        <button
          onClick={() => onDelete(comment.id)}
          className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
          title="Delete comment"
        >
          {"\u2715"}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed">
        {comment.content}
      </p>
    </div>
  );
}

// ─── Diff Viewer ──────────────────────────────────────────────────────────

export default function DiffViewer({
  diff,
  filePath: _filePath,
  workspaceId: _workspaceId,
  comments,
  onCommentCreate,
  onCommentDelete,
}: DiffViewerProps) {
  const [commenting, setCommenting] = useState<{
    startLine: number;
    endLine: number;
    afterIndex: number;
  } | null>(null);

  // Track line selection for range comments
  const [dragStart, setDragStart] = useState<{
    line: number;
    index: number;
  } | null>(null);
  const [dragEnd, setDragEnd] = useState<{
    line: number;
    index: number;
  } | null>(null);
  const isDragging = useRef(false);

  const hunks = parseDiff(diff);

  // Build a map: newLineNum -> comments at that line
  const commentsByLine = new Map<number, DiffComment[]>();
  for (const c of comments) {
    const key = c.start_line;
    if (!commentsByLine.has(key)) {
      commentsByLine.set(key, []);
    }
    commentsByLine.get(key)!.push(c);
  }

  const handleLineMouseDown = useCallback(
    (lineNum: number, index: number) => {
      isDragging.current = true;
      setDragStart({ line: lineNum, index });
      setDragEnd({ line: lineNum, index });
    },
    []
  );

  const handleLineMouseEnter = useCallback(
    (lineNum: number, index: number) => {
      if (isDragging.current) {
        setDragEnd({ line: lineNum, index });
      }
    },
    []
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current || !dragStart || !dragEnd) {
      isDragging.current = false;
      return;
    }
    isDragging.current = false;

    const startLine = Math.min(dragStart.line, dragEnd.line);
    const endLine = Math.max(dragStart.line, dragEnd.line);
    const afterIndex = Math.max(dragStart.index, dragEnd.index);

    setCommenting({ startLine, endLine, afterIndex });
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd]);

  const handleCommentSubmit = useCallback(
    (content: string) => {
      if (!commenting) return;
      onCommentCreate(commenting.startLine, commenting.endLine, content);
      setCommenting(null);
    },
    [commenting, onCommentCreate]
  );

  // Determine which lines are in the drag selection
  const selectionRange =
    dragStart && dragEnd
      ? {
          min: Math.min(dragStart.index, dragEnd.index),
          max: Math.max(dragStart.index, dragEnd.index),
        }
      : null;

  if (!diff.trim()) {
    return (
      <div className="p-4">
        <div className="rounded-md bg-slate-500/5 border border-slate-500/10 px-3 py-2">
          <span className="text-[11px] text-slate-500">
            No diff available for this file
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="font-mono text-[12px] bg-[#0a0b0f] rounded-lg border border-[#1a1a1a] overflow-x-auto select-none"
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (isDragging.current) {
          isDragging.current = false;
          setDragStart(null);
          setDragEnd(null);
        }
      }}
    >
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          {hunk.lines.map((line) => {
            const isSelected =
              selectionRange &&
              line.index >= selectionRange.min &&
              line.index <= selectionRange.max &&
              line.type !== "hunk-header";

            // The effective line number for this line (prefer new, fall back to old)
            const effectiveLine = line.newLineNum ?? line.oldLineNum;

            // Render comments after their target line
            const lineComments =
              line.newLineNum && commentsByLine.has(line.newLineNum)
                ? commentsByLine.get(line.newLineNum)!
                : [];

            // Show comment form after the right line
            const showCommentForm =
              commenting && commenting.afterIndex === line.index;

            return (
              <div key={line.index}>
                {line.type === "hunk-header" ? (
                  <div className="bg-[#111111] px-3 py-1 text-[11px] text-slate-500 border-y border-[#1a1a1a]">
                    {line.content}
                  </div>
                ) : (
                  <div
                    className={`flex ${
                      line.type === "add"
                        ? "bg-emerald-500/10"
                        : line.type === "remove"
                        ? "bg-red-500/10"
                        : ""
                    } ${isSelected ? "!bg-amber-500/20" : ""}`}
                  >
                    {/* Old line number gutter */}
                    <div
                      className="w-12 text-right pr-2 text-[11px] text-slate-600 font-mono select-none cursor-pointer hover:bg-amber-500/10 shrink-0 leading-[20px]"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (effectiveLine != null) {
                          handleLineMouseDown(effectiveLine, line.index);
                        }
                      }}
                      onMouseEnter={() => {
                        if (effectiveLine != null) {
                          handleLineMouseEnter(effectiveLine, line.index);
                        }
                      }}
                    >
                      {line.oldLineNum ?? ""}
                    </div>
                    {/* New line number gutter */}
                    <div
                      className="w-12 text-right pr-2 text-[11px] text-slate-600 font-mono select-none cursor-pointer hover:bg-amber-500/10 shrink-0 border-r border-[#1a1a1a] leading-[20px]"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (effectiveLine != null) {
                          handleLineMouseDown(effectiveLine, line.index);
                        }
                      }}
                      onMouseEnter={() => {
                        if (effectiveLine != null) {
                          handleLineMouseEnter(effectiveLine, line.index);
                        }
                      }}
                    >
                      {line.newLineNum ?? ""}
                    </div>
                    {/* +/- marker */}
                    <div className="w-5 text-center shrink-0 leading-[20px]">
                      <span
                        className={
                          line.type === "add"
                            ? "text-emerald-300"
                            : line.type === "remove"
                            ? "text-red-300"
                            : "text-transparent"
                        }
                      >
                        {line.type === "add"
                          ? "+"
                          : line.type === "remove"
                          ? "-"
                          : " "}
                      </span>
                    </div>
                    {/* Content */}
                    <div
                      className={`flex-1 px-2 whitespace-pre leading-[20px] ${
                        line.type === "add"
                          ? "text-emerald-300"
                          : line.type === "remove"
                          ? "text-red-300"
                          : "text-slate-400"
                      }`}
                    >
                      {line.content}
                    </div>
                  </div>
                )}

                {/* Existing comments at this line */}
                {lineComments.map((c) => (
                  <CommentCard
                    key={c.id}
                    comment={c}
                    onDelete={onCommentDelete}
                  />
                ))}

                {/* Inline comment form */}
                {showCommentForm && (
                  <InlineCommentForm
                    onSubmit={handleCommentSubmit}
                    onCancel={() => setCommenting(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
