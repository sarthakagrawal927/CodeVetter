import { useState, useEffect, useRef, useCallback } from "react";
import {
  generatePlaywrightTest,
  runPlaywrightTest,
  iteratePlaywrightTest,
  onPlaywrightGenStream,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type {
  PlaywrightTestResult,
  PlaywrightGenStreamEvent,
} from "@/lib/tauri-ipc";

// ─── Types ──────────────────────────────────────────────────────────────────

type Step = "input" | "generating" | "results";

interface HistoryEntry {
  id: string;
  url: string;
  description: string;
  testFile: string;
  testCode: string;
  results?: {
    passed: boolean;
    results: PlaywrightTestResult[];
  };
  createdAt: Date;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 3;

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PlaywrightGen() {
  // Input state
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [projectPath, setProjectPath] = useState("");

  // Workflow state
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // Generation state
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [testFile, setTestFile] = useState<string | null>(null);
  const [testCode, setTestCode] = useState<string | null>(null);

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [runResults, setRunResults] = useState<{
    passed: boolean;
    results: PlaywrightTestResult[];
    stdout: string;
    stderr: string;
  } | null>(null);

  // Iteration state
  const [iterationCount, setIterationCount] = useState(0);
  const [isIterating, setIsIterating] = useState(false);

  // History (in-memory)
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Clipboard feedback
  const [copied, setCopied] = useState(false);

  // Refs
  const progressRef = useRef<HTMLDivElement>(null);

  // ─── Stream listener ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isTauriAvailable()) return;

    let unlisten: (() => void) | null = null;

    onPlaywrightGenStream((event: PlaywrightGenStreamEvent) => {
      if (event.event_type === "progress") {
        const text =
          (event.content.text as string) ??
          (event.content.type as string) ??
          "";
        if (text) {
          setProgressLines((prev) => [...prev, text]);
        }
      } else if (event.event_type === "done") {
        const code = event.content.test_code as string;
        const file = event.content.test_file as string;
        setTestCode(code);
        setTestFile(file);
        setStep("results");
        setIsIterating(false);
      } else if (event.event_type === "error") {
        setError(event.content.error as string);
        setStep("results");
        setIsIterating(false);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Auto-scroll progress
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.scrollTop = progressRef.current.scrollHeight;
    }
  }, [progressLines]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    if (!description.trim()) {
      setError("Description is required");
      return;
    }

    // Basic URL validation
    try {
      new URL(url.startsWith("http") ? url : `https://${url}`);
    } catch {
      setError("Invalid URL format");
      return;
    }

    setError(null);
    setStep("generating");
    setProgressLines([]);
    setTestCode(null);
    setTestFile(null);
    setRunResults(null);
    setIterationCount(0);

    try {
      const result = await generatePlaywrightTest(
        url.startsWith("http") ? url : `https://${url}`,
        description,
        projectPath || undefined,
      );
      setActiveRequestId(result.request_id);
      setTestFile(result.test_file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("input");
    }
  }, [url, description, projectPath]);

  const handleRun = useCallback(async () => {
    if (!testFile) return;
    setIsRunning(true);
    setRunResults(null);
    setError(null);

    try {
      const result = await runPlaywrightTest(
        testFile,
        projectPath || undefined,
      );
      setRunResults(result);

      // Add to history
      if (testCode) {
        setHistory((prev) => [
          {
            id: crypto.randomUUID(),
            url,
            description,
            testFile,
            testCode,
            results: { passed: result.passed, results: result.results },
            createdAt: new Date(),
          },
          ...prev,
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [testFile, projectPath, testCode, url, description]);

  const handleIterate = useCallback(async () => {
    if (!testFile || !runResults || iterationCount >= MAX_ITERATIONS) return;

    const errorMsg =
      runResults.results
        .filter((r) => r.status === "failed")
        .map((r) => r.error ?? `Test "${r.name}" failed`)
        .join("\n\n") || runResults.stderr;

    if (!errorMsg.trim()) {
      setError("No error information to iterate on");
      return;
    }

    setIsIterating(true);
    setStep("generating");
    setProgressLines(["Sending error back to Claude for auto-fix..."]);
    setRunResults(null);
    setError(null);
    setIterationCount((prev) => prev + 1);

    try {
      const result = await iteratePlaywrightTest(
        testFile,
        errorMsg,
        url,
        description,
      );
      setActiveRequestId(result.request_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("results");
      setIsIterating(false);
    }
  }, [testFile, runResults, iterationCount, url, description]);

  const handleCopy = useCallback(() => {
    if (!testCode) return;
    navigator.clipboard.writeText(testCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [testCode]);

  const handleReset = useCallback(() => {
    setStep("input");
    setError(null);
    setProgressLines([]);
    setTestFile(null);
    setTestCode(null);
    setRunResults(null);
    setIterationCount(0);
    setActiveRequestId(null);
    setIsIterating(false);
  }, []);

  const handleLoadHistory = useCallback((entry: HistoryEntry) => {
    setUrl(entry.url);
    setDescription(entry.description);
    setTestFile(entry.testFile);
    setTestCode(entry.testCode);
    setRunResults(
      entry.results
        ? { ...entry.results, stdout: "", stderr: "" }
        : null,
    );
    setStep("results");
    setIterationCount(0);
    setError(null);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">
          Playwright Test Generator
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Describe what to test on any website. Claude writes and runs Playwright
          tests automatically.
        </p>
      </div>

      {/* Step 1: Input */}
      {step === "input" && (
        <div className="max-w-2xl rounded-xl border border-[#1e2231] bg-[#13151c] p-6">
          <div className="flex flex-col gap-5">
            {/* URL */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="rounded-lg border border-[#1e2231] bg-[#0a0b0f] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-amber-500/50 transition-colors"
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                What to test
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Test that the login flow works — enter email, password, click submit, verify dashboard loads"
                rows={4}
                className="rounded-lg border border-[#1e2231] bg-[#0a0b0f] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-amber-500/50 transition-colors resize-none"
              />
            </div>

            {/* Project path */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Project directory{" "}
                <span className="text-slate-600 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="/path/to/project (tests saved here)"
                className="rounded-lg border border-[#1e2231] bg-[#0a0b0f] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-amber-500/50 transition-colors"
              />
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              className="mt-1 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              Generate Test
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Generating */}
      {step === "generating" && (
        <div className="max-w-2xl flex flex-col gap-4">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              <p className="text-sm text-amber-400">
                {isIterating
                  ? `Iterating on test (attempt ${iterationCount}/${MAX_ITERATIONS})...`
                  : "Generating Playwright test with Claude..."}
              </p>
            </div>
          </div>

          {/* Progress log */}
          {progressLines.length > 0 && (
            <div
              ref={progressRef}
              className="max-h-[200px] overflow-y-auto rounded-lg border border-[#1e2231] bg-[#0a0b0f] p-3 font-mono text-[11px] text-slate-500"
            >
              {progressLines.map((line, i) => (
                <div key={i} className="leading-5">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="max-w-2xl rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-xs text-red-500 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Step 3: Results */}
      {step === "results" && testCode && (
        <div className="flex flex-col gap-6 fade-in">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">
              Generated Test
              {iterationCount > 0 && (
                <span className="ml-2 text-xs text-slate-500">
                  (iteration {iterationCount})
                </span>
              )}
            </h2>
            <button
              onClick={handleReset}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              New Test
            </button>
          </div>

          {/* Code block */}
          <div className="relative rounded-lg border border-[#1e2231] bg-[#0a0b0f] p-4">
            <pre className="max-h-[400px] overflow-auto font-mono text-[12px] text-slate-300 leading-5 whitespace-pre-wrap">
              {testCode}
            </pre>
            {/* Copy button - top-right */}
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 rounded-md bg-[#1e2231] px-2 py-1 text-[10px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* File path */}
          {testFile && (
            <p className="text-[11px] text-slate-600 font-mono truncate">
              {testFile}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {isRunning ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-black border-t-transparent" />
                  Running...
                </span>
              ) : (
                "Run Test"
              )}
            </button>
            <button
              onClick={handleCopy}
              className="rounded-lg border border-[#1e2231] bg-[#13151c] px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-[#2d3348]"
            >
              {copied ? "Copied!" : "Copy Code"}
            </button>
          </div>

          {/* Run Results */}
          {runResults && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-slate-200">
                Results
              </h3>

              {/* Overall status */}
              <div
                className={`rounded-lg border p-3 ${
                  runResults.passed
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-red-500/20 bg-red-500/5"
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    runResults.passed ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {runResults.passed ? "All tests passed" : "Some tests failed"}
                </p>
              </div>

              {/* Individual results */}
              {runResults.results.map((result, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-[#1e2231] bg-[#13151c] px-4 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        result.status === "passed"
                          ? "text-emerald-400"
                          : result.status === "skipped"
                            ? "text-slate-500"
                            : "text-red-400"
                      }
                    >
                      {result.status === "passed"
                        ? "\u2713"
                        : result.status === "skipped"
                          ? "\u2013"
                          : "\u2717"}
                    </span>
                    <span className="text-sm text-slate-300">
                      {result.name}
                    </span>
                  </div>
                  <span className="text-xs text-slate-600">
                    {(result.duration_ms / 1000).toFixed(1)}s
                  </span>
                </div>
              ))}

              {/* Error details */}
              {runResults.results.some((r) => r.error) && (
                <div className="rounded-lg border border-[#1e2231] bg-[#0a0b0f] p-3">
                  <p className="mb-1 text-xs font-semibold text-red-400">
                    Error Details
                  </p>
                  {runResults.results
                    .filter((r) => r.error)
                    .map((r, i) => (
                      <pre
                        key={i}
                        className="mt-1 text-[11px] text-red-400/70 font-mono whitespace-pre-wrap"
                      >
                        {r.error}
                      </pre>
                    ))}
                </div>
              )}

              {/* Iterate button (if failed) */}
              {!runResults.passed && iterationCount < MAX_ITERATIONS && (
                <button
                  onClick={handleIterate}
                  disabled={isIterating}
                  className="w-fit rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {isIterating ? "Iterating..." : `Iterate (${MAX_ITERATIONS - iterationCount} attempts left)`}
                </button>
              )}

              {/* Stderr output (collapsible) */}
              {runResults.stderr && (
                <details className="group">
                  <summary className="cursor-pointer text-xs text-slate-600 hover:text-slate-400">
                    Show stderr output
                  </summary>
                  <pre className="mt-2 max-h-[200px] overflow-auto rounded-lg border border-[#1e2231] bg-[#0a0b0f] p-3 font-mono text-[11px] text-slate-500 whitespace-pre-wrap">
                    {runResults.stderr}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && step === "input" && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-200">
            Recent Tests
          </h2>
          <div className="flex flex-col gap-2">
            {history.map((entry) => (
              <button
                key={entry.id}
                onClick={() => handleLoadHistory(entry)}
                className="flex items-center justify-between rounded-lg border border-[#1e2231] bg-[#13151c] p-3 text-left transition-colors hover:border-[#2d3348]"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-300 truncate">
                    {entry.url}
                  </p>
                  <p className="text-xs text-slate-600 truncate">
                    {entry.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  {entry.results && (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        entry.results.passed
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {entry.results.passed ? "passed" : "failed"}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-600">
                    {entry.createdAt.toLocaleTimeString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
