import { useMemo, useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tab, TabBar } from "@/components/workspace/tab-bar";
import { SqlText } from "@/components/workspace/sql-text";
import {
  useLogLines,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { LogLine, LogLevel } from "@/lib/workspace/log-line";
import {
  filterLogLines,
  highlightLogSearch,
  type HighlightSegment,
} from "@/lib/workspace/log-search";

type ConsoleTab = "log" | "changes" | "history" | "logs";

// Whether the active tab has clearable content (History entries / pending edits / Console log lines
// / application log lines).
function clearTarget(
  tab: ConsoleTab,
  historyCount: number,
  pendingCount: number,
  logCount: number,
  appLogCount: number,
): boolean {
  if (tab === "history") {
    return historyCount > 0;
  }
  if (tab === "changes") {
    return pendingCount > 0;
  }
  if (tab === "logs") {
    return appLogCount > 0;
  }
  return logCount > 0;
}

// The Clear action for the active tab: History clears history, Changes discards all pending edits,
// Console (log) clears the script-output lines, Logs clears the application log lines.
function clearForTab(
  tab: ConsoleTab,
  actions: {
    clearHistory: () => void;
    discardAllPendingEdits: () => void;
    clearConsole: () => void;
    clearLogLines: () => void;
  },
): () => void {
  if (tab === "history") {
    return actions.clearHistory;
  }
  if (tab === "changes") {
    return actions.discardAllPendingEdits;
  }
  if (tab === "logs") {
    return actions.clearLogLines;
  }
  return actions.clearConsole;
}

// Whole-line tint by level: error red, warn amber, info/debug/trace muted grey. info is muted (not
// foreground) so the plain message words (`[dbui_lib][INFO] connect`) read grey while the kv VALUES,
// which set their own text-foreground, stand out white. error/warn keep their signal color.
const LEVEL_LINE_CLASS: Record<LogLevel, string> = {
  error: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-muted-foreground",
  debug: "text-muted-foreground",
  trace: "text-muted-foreground",
};

const LEVEL_BADGE_CLASS: Record<LogLevel, string> = {
  error: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  debug: "text-muted-foreground",
  trace: "text-muted-foreground",
};

// One application-log line: whole-line tint by level, muted timestamp, colored level badge, and the
// message with its key=value pairs dimmed keys + accented values. Falls back to the raw text when
// the line was unparseable (empty timestamp).
function LogLineRow({ line }: { line: LogLine }) {
  const parts = line.message.split(/(\s+)/);
  return (
    <li className={cn("py-0.5 break-all", LEVEL_LINE_CLASS[line.level])}>
      {line.timestamp ? (
        <span className="text-muted-foreground">{line.timestamp} </span>
      ) : null}
      <span className={cn("uppercase", LEVEL_BADGE_CLASS[line.level])}>
        {line.level}
      </span>{" "}
      {parts.map((part, index) => {
        const kv = part.match(/^([A-Za-z_]+)=(\S+)$/);
        if (!kv) {
          return <span key={index}>{part}</span>;
        }
        return (
          <span key={index}>
            <span className={KV_KEY_CLASS}>{kv[1]}=</span>
            <span className={KV_VALUE_CLASS}>{kv[2]}</span>
          </span>
        );
      })}
    </li>
  );
}

// key=value coloring shared by the log lines + the search overlay: keys orange, values white
// (foreground), plain/bare text muted grey.
const KV_KEY_CLASS = "text-orange-600 dark:text-orange-400";
const KV_VALUE_CLASS = "text-foreground";

const SEARCH_SEGMENT_CLASS: Record<HighlightSegment["kind"], string> = {
  key: KV_KEY_CLASS,
  value: KV_VALUE_CLASS,
  plain: "text-muted-foreground",
};

// Shared box geometry for the search input + its highlight overlay - IDENTICAL padding/size/font on
// both so the tinted text sits exactly under the real (transparent-text) input. The border lives
// only on the input; the overlay is inset by the same 1px so text still aligns.
const SEARCH_BOX =
  "h-5 w-52 px-2 text-xs leading-5 whitespace-pre overflow-hidden";

// The Logs search field with live field-key coloring. A plain <input> can't tint substrings, so a
// mirrored highlight layer renders behind a transparent-text input (the input still owns the
// caret/selection/typing). autoCapitalize/autoCorrect off so a mobile/IME keyboard never
// upper-cases the first letter of a `field:value` query (design.md input rule).
function LogSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const segments = highlightLogSearch(value);
  return (
    <div className="relative bg-background">
      <div
        aria-hidden="true"
        className={cn(
          SEARCH_BOX,
          "pointer-events-none absolute inset-0 flex items-center border border-transparent",
        )}
      >
        {segments.map((segment, index) => (
          <span key={index} className={SEARCH_SEGMENT_CLASS[segment.kind]}>
            {segment.text}
          </span>
        ))}
      </div>
      <input
        type="search"
        aria-label="Search logs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="level:error connection_id:db1 ..."
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          SEARCH_BOX,
          "relative border bg-transparent text-transparent caret-foreground placeholder:text-muted-foreground focus:outline-none",
        )}
      />
    </div>
  );
}

export function Console() {
  const {
    consoleLines,
    pendingEdits,
    discardPendingEdit,
    discardAllPendingEdits,
    history,
    clearHistory,
    clearConsole,
  } = useWorkspace();
  const { logLines, clearLogLines } = useLogLines();
  const pendingCount = pendingEdits.length;
  const [tab, setTab] = useState<ConsoleTab>("log");
  const [logSearch, setLogSearch] = useState("");
  const filteredLogs = useMemo(
    () => filterLogLines(logLines, logSearch),
    [logLines, logSearch],
  );
  // Stick the Logs list to the bottom as new lines arrive (only while the Logs tab is open).
  const logsEndRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (tab === "logs") {
      logsEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [tab, filteredLogs.length]);
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
  // Focus the Console (log) tab when a script run emits its first line, so output is visible even if
  // the user was on History/Changes (mirrors the history/changes rising-edge focus).
  const [prevLog, setPrevLog] = useState(consoleLines.length);
  if (prevLog !== consoleLines.length) {
    if (consoleLines.length > prevLog) {
      setTab("log");
    }
    setPrevLog(consoleLines.length);
  }

  return (
    <section
      aria-label="Console"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/30 font-mono text-xs"
    >
      <TabBar
        ariaLabel="Console panels"
        className="h-7"
        trailing={
          <div className="ml-auto flex items-center">
            {tab === "logs" ? (
              <LogSearchInput value={logSearch} onChange={setLogSearch} />
            ) : null}
            {clearTarget(
              tab,
              history.length,
              pendingCount,
              consoleLines.length,
              logLines.length,
            ) ? (
              <button
                type="button"
                onClick={clearForTab(tab, {
                  clearHistory,
                  discardAllPendingEdits,
                  clearConsole,
                  clearLogLines,
                })}
                className="px-3 py-1.5 tracking-wide text-muted-foreground uppercase hover:text-foreground"
              >
                Clear
              </button>
            ) : null}
          </div>
        }
      >
        <Tab
          isActive={tab === "history"}
          onSelect={() => setTab("history")}
          labelClassName="text-xs tracking-wide"
        >
          History{history.length > 0 ? ` (${history.length})` : ""}
        </Tab>
        <Tab
          isActive={tab === "changes"}
          onSelect={() => setTab("changes")}
          labelClassName="text-xs tracking-wide"
        >
          Changes{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </Tab>
        <Tab
          isActive={tab === "log"}
          onSelect={() => setTab("log")}
          labelClassName="text-xs tracking-wide"
        >
          Console
        </Tab>
        <Tab
          isActive={tab === "logs"}
          onSelect={() => setTab("logs")}
          labelClassName="text-xs tracking-wide"
        >
          Logs{logLines.length > 0 ? ` (${logLines.length})` : ""}
        </Tab>
      </TabBar>
      {tab === "log" ? (
        <ScrollArea key="log" className="min-h-0 flex-1">
          <ul className="p-2">
            {consoleLines.map((line, index) => (
              <li
                key={index}
                className={cn(
                  "py-0.5",
                  line.startsWith("[error]")
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground",
                )}
              >
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
                  <SqlText
                    sql={edit.sql}
                    className="min-w-0 flex-1 break-all whitespace-pre-wrap"
                  />
                  <button
                    type="button"
                    aria-label={
                      edit.kind === "cell"
                        ? `Discard change to ${edit.column}`
                        : `Discard ${edit.kind}`
                    }
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
      ) : tab === "logs" ? (
        <ScrollArea key="logs" className="min-h-0 flex-1">
          {logLines.length === 0 ? (
            <p className="p-3 text-muted-foreground">
              No application logs yet this session.
            </p>
          ) : filteredLogs.length === 0 ? (
            <p className="p-3 text-muted-foreground">No matching log lines.</p>
          ) : (
            <ul aria-label="Application logs" className="p-2">
              {filteredLogs.map((line, index) => (
                <LogLineRow key={index} line={line} />
              ))}
              <li ref={logsEndRef} aria-hidden="true" />
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
                  <SqlText
                    sql={entry.sql}
                    className="block break-all whitespace-pre-wrap"
                  />
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      )}
    </section>
  );
}
