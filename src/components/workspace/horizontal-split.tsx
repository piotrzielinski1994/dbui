import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SplitOrientation } from "@/components/workspace/workspace-context";

// A two-pane split with a draggable divider, either side-by-side ("horizontal") or
// stacked ("vertical"). Hand-rolled (not react-resizable-panels) because that library's
// global pointer handlers break radix Tabs switching under jsdom, and this split lives
// inside a Tabs panel (see docs/learnings.md). The first pane's size is a percentage of
// the container along the split axis, clamped 15-85%.
export function HorizontalSplit({
  left,
  right,
  ariaLabel,
  className,
  orientation = "horizontal",
  initialLeftPercent = 50,
  onLeftPercentChange,
}: {
  left: ReactNode;
  right: ReactNode;
  ariaLabel: string;
  className?: string;
  orientation?: SplitOrientation;
  initialLeftPercent?: number;
  onLeftPercentChange?: (percent: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftPercent, setLeftPercent] = useState(initialLeftPercent);
  const isVertical = orientation === "vertical";

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const span = isVertical ? rect.height : rect.width;
      if (span === 0) {
        return;
      }
      const offset = isVertical
        ? event.clientY - rect.top
        : event.clientX - rect.left;
      setLeftPercent(Math.min(85, Math.max(15, (offset / span) * 100)));
    },
    [isVertical],
  );

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const stop = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      setLeftPercent((final) => {
        onLeftPercentChange?.(final);
        return final;
      });
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
  };

  const firstSize = isVertical
    ? { height: `${leftPercent}%` }
    : { width: `${leftPercent}%` };

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0", isVertical ? "flex-col" : "w-full", className)}
    >
      <div
        className={cn("overflow-hidden", isVertical ? "min-h-0" : "min-w-0")}
        style={firstSize}
      >
        {left}
      </div>
      <div
        role="separator"
        aria-orientation={isVertical ? "horizontal" : "vertical"}
        aria-label={ariaLabel}
        onPointerDown={startDrag}
        className={cn(
          "relative shrink-0 bg-border",
          isVertical
            ? "h-px w-full cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2"
            : "w-px cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2",
        )}
      />
      <div className={cn("flex-1 overflow-hidden", isVertical ? "min-h-0" : "min-w-0")}>
        {right}
      </div>
    </div>
  );
}
