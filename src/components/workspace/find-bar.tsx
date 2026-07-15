import { useEffect, useRef, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared presentational find bar - reused by the grid and (styled) by the CodeMirror search panel.
// Purely driven by props; it computes no matches itself. Design.md compliant: no rounded corners
// (radius is pinned to 0), theme tokens (never hard-coded colors), IDE density, 1px dividers.
export type FindBarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  // 1-based index of the active match; 0 when there are no matches.
  activeIndex: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  // Enter/Shift+Enter cycle matches; Escape closes. The grid drives these through the input so the
  // key handling lives with the bar, not the host. Optional so the CM panel can omit it.
  onSubmit?: (backwards: boolean) => void;
  autoFocus?: boolean;
};

export function FindBar({
  query,
  onQueryChange,
  activeIndex,
  total,
  onNext,
  onPrev,
  onClose,
  onSubmit,
  autoFocus = true,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const hasMatches = total > 0;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit?.(event.shiftKey);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-b-border bg-background px-2 py-1 text-xs">
      <input
        ref={inputRef}
        type="text"
        aria-label="Find"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find"
        className={cn(
          "h-6 w-48 bg-muted px-2 font-mono text-xs text-foreground outline-none",
          query.length > 0 && !hasMatches && "text-destructive",
        )}
      />
      <span className="w-14 shrink-0 text-center font-mono text-muted-foreground tabular-nums">
        {activeIndex}/{total}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        disabled={!hasMatches}
        onClick={onPrev}
        className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        disabled={!hasMatches}
        onClick={onNext}
        className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Close find"
        onClick={onClose}
        className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
