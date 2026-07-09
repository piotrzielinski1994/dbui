import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// One shared tab strip used by every tabbed surface (open content tabs, the database card's
// SQL/Views/Script/Settings, the console's History/Changes/Console). Centralising it kills the
// drift that came from three hand-rolled copies.
//
// The tablist owns its OWN horizontal scroller (`min-w-0 overflow-x-auto overflow-y-hidden`) so
// overflowing tabs scroll INSIDE the bar instead of stretching it and dragging the whole content
// pane into a horizontal scroll. `min-w-0` lets the flex child shrink below its tabs' intrinsic
// width; `overflow-y-hidden` suppresses the stray vertical scrollbar that `overflow-x-auto` would
// otherwise force.
//
// The 1px underline can't use a bottom-border overhang (a vertical scroller clips it): instead the
// baseline is a 1px inset `--border` shadow carried by the bar (covers the trailing area) AND by
// every inactive tab (so `hover:bg-accent` never opens a gap in the divider). The active tab swaps
// its own inset shadow to `--primary`, drawn on top - one underline, never an underline+border
// stack, and nothing overhangs the box so the scroller clips nothing.

export function TabBar({
  ariaLabel,
  children,
  trailing,
  className,
}: {
  ariaLabel: string;
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-stretch bg-muted/30 shadow-[inset_0_-1px_0_0_var(--border)]",
        className,
      )}
    >
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex h-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden"
      >
        {children}
      </div>
      {trailing}
    </div>
  );
}

type TabProps = {
  isActive: boolean;
  onSelect: () => void;
  ariaLabel?: string;
  children: ReactNode;
  trailing?: ReactNode;
  labelClassName?: string;
  // Extra props (e.g. a radix ContextMenuTrigger's onContextMenu + ref) spread onto the tab's
  // outer element, so a tab can host a context menu without an extra wrapper div that would break
  // the 1px active-underline overhang.
} & ComponentPropsWithoutRef<"div">;

export const Tab = forwardRef<HTMLDivElement, TabProps>(function Tab(
  { isActive, onSelect, ariaLabel, children, trailing, labelClassName, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cn(
        "flex h-full shrink-0 items-center border-r after:hidden hover:bg-accent",
        isActive
          ? "bg-accent shadow-[inset_0_-1px_0_0_var(--primary)]"
          : "bg-transparent shadow-[inset_0_-1px_0_0_var(--border)]",
        className,
      )}
    >
      {/* The label button fills the tab's full height + carries the horizontal padding, so the
          ENTIRE tab area (not just the glyph) is the click target. A trailing control (close X) sits
          after it with its own handler. */}
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={ariaLabel}
        onClick={onSelect}
        className={cn(
          "flex h-full items-center gap-1.5 truncate px-3 text-sm",
          trailing ? "pr-1" : "",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          labelClassName,
        )}
      >
        {children}
      </button>
      {trailing ? <div className="pr-2">{trailing}</div> : null}
    </div>
  );
});
