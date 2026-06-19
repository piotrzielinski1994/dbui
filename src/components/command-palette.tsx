import { useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useHotkey("Mod+K", (event) => {
    event.preventDefault();
    setIsOpen((open) => !open);
  });

  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-testid="command-palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm text-muted-foreground">
          Command palette (placeholder). Press{" "}
          <kbd className="rounded border px-1">Esc</kbd> or click outside to
          close.
        </p>
      </div>
    </div>
  );
}
