import { useState, useEffect, useCallback } from "react";
import { isTauriAvailable, getPreference, setPreference } from "@/lib/tauri-ipc";
import { Button } from "@/components/ui/button";

const PLACEHOLDER = `Use Tailwind CSS, not MUI or styled-components
Use async/await, never .then() chains
Types are auto-generated in /types/api.ts — use them, don't create manual types`;

interface RulesEditorProps {
  workspaceId?: string;
}

export default function RulesEditor({ workspaceId }: RulesEditorProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"workspace" | "global">(
    workspaceId ? "workspace" : "global"
  );

  const storageKey =
    scope === "workspace" && workspaceId
      ? `review_rules_${workspaceId}`
      : "review_rules_global";

  // Load existing rules on mount / scope change
  const loadRules = useCallback(async () => {
    if (!isTauriAvailable()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const raw = await getPreference(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) {
          setText(parsed.join("\n"));
        }
      } else {
        setText("");
      }
    } catch {
      setText("");
    } finally {
      setLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // Save rules
  async function handleSave() {
    if (!isTauriAvailable()) return;
    setSaving(true);
    try {
      const rules = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await setPreference(storageKey, JSON.stringify(rules));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save rules:", err);
    } finally {
      setSaving(false);
    }
  }

  const ruleCount = text
    .split("\n")
    .filter((line) => line.trim().length > 0).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2231] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-300">
            Review Rules
          </span>
          {ruleCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 text-[9px] font-semibold text-amber-400">
              {ruleCount}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={saving || loading}
          className="h-auto px-2 py-0.5 text-[10px] font-medium text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 hover:text-amber-400 disabled:opacity-50"
        >
          {saved ? "Saved" : saving ? "Saving..." : "Save"}
        </Button>
      </div>

      {/* Scope toggle (only show when workspace context exists) */}
      {workspaceId && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#1e2231]/50 shrink-0">
          <button
            onClick={() => setScope("workspace")}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              scope === "workspace"
                ? "bg-amber-500/15 text-amber-400"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            This workspace
          </button>
          <button
            onClick={() => setScope("global")}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              scope === "global"
                ? "bg-amber-500/15 text-amber-400"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Global
          </button>
        </div>
      )}

      {/* Description */}
      <div className="px-3 py-1.5 shrink-0">
        <p className="text-[10px] text-slate-600 leading-relaxed">
          One rule per line. These rules are injected into the AI review prompt
          to enforce your team's conventions.
        </p>
      </div>

      {/* Textarea */}
      <div className="flex-1 px-3 pb-3 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <span className="ml-2 text-[10px] text-slate-500">Loading...</span>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className="w-full h-full min-h-[120px] resize-none rounded-md border border-[#1e2231] bg-[#0a0b0f] px-3 py-2 text-[11px] text-slate-300 font-mono leading-relaxed placeholder:text-slate-700 focus:outline-none focus:border-amber-500/30 focus:ring-1 focus:ring-amber-500/20"
          />
        )}
      </div>
    </div>
  );
}
