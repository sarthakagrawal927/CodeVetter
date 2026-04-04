import { useState, useCallback, useRef } from "react";
import type { SearchResult } from "@/lib/tauri-ipc";

interface SearchBarProps {
  placeholder?: string;
  onSearch: (query: string) => void;
  debounceMs?: number;
  isSearching?: boolean;
  searchResults?: SearchResult[];
  onResultClick?: (result: SearchResult) => void;
}

/**
 * Highlight occurrences of `query` within `text` by wrapping them in <mark>.
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark
        key={i}
        className="rounded-sm bg-amber-500/30 text-amber-200 px-0.5"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SearchBar({
  placeholder = "Search...",
  onSearch,
  debounceMs = 300,
  isSearching = false,
  searchResults,
  onResultClick,
}: SearchBarProps) {
  const [value, setValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setValue(newValue);

      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        onSearch(newValue);
        if (newValue.trim().length > 0) {
          setShowDropdown(true);
        }
      }, debounceMs);
    },
    [onSearch, debounceMs]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (timerRef.current) clearTimeout(timerRef.current);
      onSearch(value);
      if (value.trim().length > 0) {
        setShowDropdown(true);
      }
    }
    if (e.key === "Escape") {
      setShowDropdown(false);
    }
  }

  function handleClear() {
    setValue("");
    onSearch("");
    setShowDropdown(false);
    inputRef.current?.focus();
  }

  function handleResultClick(result: SearchResult) {
    setShowDropdown(false);
    onResultClick?.(result);
  }

  const hasResults = searchResults && searchResults.length > 0;

  return (
    <div className="relative">
      {/* Search icon or loading spinner */}
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
        {isSearching ? (
          <svg
            className="h-3.5 w-3.5 animate-spin text-amber-400"
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
        ) : (
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </span>

      <input
        ref={inputRef}
        data-search-input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (value.trim().length > 0 && hasResults) {
            setShowDropdown(true);
          }
        }}
        onBlur={() => {
          // Delay hiding so clicks on results register
          setTimeout(() => setShowDropdown(false), 200);
        }}
        placeholder={placeholder}
        className="w-full rounded border border-[#1a1a1a] bg-[#0f1117] py-1.5 pl-8 pr-8 text-[13px] text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-amber-500/40"
      />

      {/* Clear button */}
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-xs text-slate-500 hover:text-slate-300"
        >
          {"\u2715"}
        </button>
      )}

      {/* Search results dropdown */}
      {showDropdown && value.trim().length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-y-auto rounded-lg border border-[#1a1a1a] bg-[#0a0a0a] shadow-xl">
          {isSearching && !hasResults && (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              Searching...
            </div>
          )}
          {!isSearching && !hasResults && (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              No results found for &quot;{value}&quot;
            </div>
          )}
          {hasResults &&
            searchResults.map((result) => (
              <button
                key={result.message_id}
                onClick={() => handleResultClick(result)}
                className="flex w-full flex-col gap-1 border-b border-[#1a1a1a] px-4 py-3 text-left transition-colors hover:bg-[#111111] last:border-b-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    {result.role ?? "message"}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {formatTimestamp(result.timestamp)}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs leading-relaxed text-slate-300">
                  {highlightMatch(
                    result.content_text.slice(0, 200),
                    value
                  )}
                </p>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
