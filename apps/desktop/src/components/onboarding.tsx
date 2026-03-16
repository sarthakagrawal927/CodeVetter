import { useState } from "react";
import {
  setPreference,
  triggerIndex,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { TriggerIndexResult } from "@/lib/tauri-ipc";

interface OnboardingProps {
  onComplete: () => void;
}

type Step = "welcome" | "detect" | "index" | "done";

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [indexResult, setIndexResult] = useState<TriggerIndexResult | null>(
    null
  );
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDetect() {
    setStep("detect");
    // Mark onboarding as started
    if (isTauriAvailable()) {
      await setPreference("onboarding_complete", "false").catch(() => {});
    }
    // Auto-advance after a brief delay
    setTimeout(() => setStep("index"), 1500);
  }

  async function handleIndex() {
    setIndexing(true);
    setError(null);
    try {
      const result = await triggerIndex();
      setIndexResult(result);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("done");
    } finally {
      setIndexing(false);
    }
  }

  async function handleFinish() {
    if (isTauriAvailable()) {
      await setPreference("onboarding_complete", "true").catch(() => {});
    }
    localStorage.setItem("onboarding_complete", "true");
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0c10]/90 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[#1e2231] bg-[#13151c] p-8 shadow-2xl">
        {step === "welcome" && (
          <div className="flex flex-col items-center text-center gap-6 fade-in">
            <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
              <span className="text-3xl text-amber-400">{"\u25C8"}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100">
                Welcome to CodeVetter
              </h1>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                AI-powered code review, agent management, and unified session
                history — all in one desktop app.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full text-left">
              <Feature
                icon={"\u2714"}
                title="Code Review"
                desc="Local diff and PR review powered by Claude"
              />
              <Feature
                icon={"\u25B6"}
                title="Mission Control"
                desc="Launch and manage Claude Code & Codex agents"
              />
              <Feature
                icon={"\u2630"}
                title="Session History"
                desc="Search and browse all your AI coding sessions"
              />
            </div>
            <button
              onClick={handleDetect}
              className="w-full rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
            >
              Get Started
            </button>
          </div>
        )}

        {step === "detect" && (
          <div className="flex flex-col items-center text-center gap-6 fade-in">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                Detecting your environment
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Looking for Claude Code sessions and CLI tools...
              </p>
            </div>
          </div>
        )}

        {step === "index" && (
          <div className="flex flex-col items-center text-center gap-6 fade-in">
            <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <span className="text-3xl text-emerald-400">{"\u2630"}</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                Index Your Sessions
              </h2>
              <p className="mt-1 text-sm text-slate-400 leading-relaxed">
                Scan ~/.claude/projects/ to import your Claude Code session
                history. This enables full-text search across all your
                conversations.
              </p>
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setStep("done")}
                className="flex-1 rounded-lg border border-[#1e2231] px-4 py-2.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
              >
                Skip
              </button>
              <button
                onClick={handleIndex}
                disabled={indexing}
                className="flex-1 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
              >
                {indexing ? "Indexing..." : "Index Now"}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center text-center gap-6 fade-in">
            <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <span className="text-3xl text-emerald-400">{"\u2713"}</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                You&apos;re all set!
              </h2>
              {indexResult ? (
                <p className="mt-1 text-sm text-slate-400">
                  Indexed {indexResult.indexed_sessions} sessions and{" "}
                  {indexResult.indexed_messages} messages across{" "}
                  {indexResult.projects_scanned} projects.
                </p>
              ) : error ? (
                <p className="mt-1 text-sm text-red-400">
                  Indexing encountered an issue: {error}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-400">
                  You can always index sessions later from the Sessions page.
                </p>
              )}
            </div>
            <button
              onClick={handleFinish}
              className="w-full rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
            >
              Open CodeVetter
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#1e2231] bg-[#0f1117] p-3">
      <span className="text-amber-400">{icon}</span>
      <div>
        <p className="text-xs font-medium text-slate-200">{title}</p>
        <p className="text-[11px] text-slate-500">{desc}</p>
      </div>
    </div>
  );
}
