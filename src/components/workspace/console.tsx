import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/components/workspace/workspace-context";

type ConsoleTab = "log" | "changes" | "history";

export function Console() {
  const { consoleLines, pendingEdits, discardPendingEdit, history } =
    useWorkspace();
  const pendingCount = pendingEdits.length;
  const [tab, setTab] = useState<ConsoleTab>("log");
  // Auto-focus Changes on the first edit (0 -> 1) and History on each new run,
  // both only on the rising edge so manual tab choices otherwise stick.
  const [prevCount, setPrevCount] = useState(pendingCount);
  if (prevCount !== pendingCount) {
    if (prevCount === 0 && pendingCount > 0) {
      setTab("changes");
    }
    setPrevCount(pendingCount);
  }
  const [prevHistory, setPrevHistory] = useState(history.length);
  if (prevHistory !== history.length) {
    if (history.length > prevHistory) {
      setTab("history");
    }
    setPrevHistory(history.length);
  }

  return (
    <section
      aria-label="Console"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/30 font-mono text-xs"
    >
      <div
        role="tablist"
        aria-label="Console panels"
        className="flex shrink-0 items-stretch border-b"
      >
        <ConsoleTabButton
          isActive={tab === "log"}
          onClick={() => setTab("log")}
        >
          Console
        </ConsoleTabButton>
        <ConsoleTabButton
          isActive={tab === "changes"}
          onClick={() => setTab("changes")}
        >
          Changes{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </ConsoleTabButton>
        <ConsoleTabButton
          isActive={tab === "history"}
          onClick={() => setTab("history")}
        >
          History{history.length > 0 ? ` (${history.length})` : ""}
        </ConsoleTabButton>
      </div>
      {tab === "log" ? (
        <ScrollArea key="log" className="min-h-0 flex-1">
          <ul className="p-2">
            {consoleLines.map((line, index) => (
              <li key={index} className="py-0.5 text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        </ScrollArea>
      ) : tab === "changes" ? (
        <ScrollArea key="changes" className="min-h-0 flex-1">
          {pendingCount === 0 ? (
            <p className="p-3 text-muted-foreground">No pending changes.</p>
          ) : (
            <ul aria-label="Pending changes">
              {pendingEdits.map((edit) => (
                <li
                  key={edit.id}
                  className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
                >
                  <code className="min-w-0 flex-1 break-all whitespace-pre-wrap">
                    {edit.sql}
                  </code>
                  <button
                    type="button"
                    aria-label={`Discard change to ${edit.column}`}
                    onClick={() => discardPendingEdit(edit.id)}
                    className="shrink-0 p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      ) : (
        <ScrollArea key="history" className="min-h-0 flex-1">
          {history.length === 0 ? (
            <p className="p-3 text-muted-foreground">
              No queries run yet this session.
            </p>
          ) : (
            <ul aria-label="Query history">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-0.5 border-b px-3 py-1.5 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        entry.status === "success"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {entry.status === "success" ? "OK" : "ERR"}
                    </span>
                    <span className="text-muted-foreground">{entry.at}</span>
                    <span className="truncate text-muted-foreground">
                      {entry.message}
                    </span>
                  </div>
                  <code className="break-all whitespace-pre-wrap">
                    {entry.sql}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      )}
    </section>
  );
}

function ConsoleTabButton({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        "border-r px-3 py-1.5 tracking-wide uppercase",
        isActive
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
