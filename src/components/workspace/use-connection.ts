import { toast } from "sonner";
import {
  cancelConnect,
  connectDatabase,
  disconnectDatabase,
  fetchSchema,
} from "@/lib/tauri";
import { toResult } from "@/lib/result";

// The Rust connect path rejects a cancelled connect with this exact string (mirrors the query
// cancel sentinel). A cancelled connect is neutral - it resets to idle without an error toast.
const CANCEL_SENTINEL = "__cancelled__";

// Ids with a connect in flight. Two triggers can fire connect() for the same database in the SAME
// mount tick (the sidebar row auto-connecting a restored-expanded database AND the active database
// card's own auto-connect), and the `connectionStatus === "connecting"` guard is racy on mount -
// both read "idle" before setConnectionStatus lands. This module-level set is shared across every
// useConnectionActions instance and updated synchronously, so a duplicate connect is dropped before
// the second connectDatabase call (which would otherwise double the pool open + success toast).
const inFlightConnects = new Set<string>();

// Test-only: clears the module-level in-flight guard between tests. A test whose connect mock never
// resolves (e.g. the Cancel-button test) would otherwise leave an id stuck in the set and silently
// drop the next test's connect for the same database id. Not used by production code.
export function __resetInFlightConnects() {
  inFlightConnects.clear();
}
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { ConnectionConfig } from "@/lib/workspace/model";

export function useConnectionActions() {
  const {
    setConnection,
    setConnectionStatus,
    setDatabaseTables,
    setDatabaseViews,
    setDatabaseSchema,
    removeConnection,
    updateDatabaseConfig,
    connectionStatus,
    clearTxStatements,
  } = useWorkspace();

  const connect = async (id: string, config: ConnectionConfig) => {
    if (connectionStatus.get(id) === "connecting" || inFlightConnects.has(id)) {
      return;
    }
    inFlightConnects.add(id);
    setConnectionStatus(id, "connecting");
    try {
      const result = await toResult(connectDatabase(id, config));
      if (!result.ok) {
        // A user-cancelled connect is not a failure: drop back to idle, no error toast.
        if (result.error === CANCEL_SENTINEL) {
          setConnectionStatus(id, "idle");
          return;
        }
        setConnectionStatus(id, "error");
        toast.error(result.error);
        return;
      }
      const { tables, views } = result.value;
      setConnection(id, config);
      updateDatabaseConfig(id, config);
      setDatabaseTables(id, tables);
      setDatabaseViews(
        id,
        views.map((view) => ({ name: view.name })),
      );
      setConnectionStatus(id, "connected");
      toast.success(`Connected - ${tables.length} tables`);

      // Schema feeds the SQL editor's autocomplete; a failure leaves the connection up with no
      // completion data rather than blocking the connect.
      const schema = await toResult(fetchSchema(id));
      setDatabaseSchema(id, schema.ok ? schema.value : []);
    } finally {
      inFlightConnects.delete(id);
    }
  };

  const disconnect = (id: string) => {
    void disconnectDatabase(id);
    removeConnection(id);
    setConnectionStatus(id, "idle");
    // The backend auto-rolls-back any open transaction on disconnect (F12); drop its recorded
    // statement list so a later reconnect never shows stale uncommitted lines.
    clearTxStatements(id);
  };

  // Aborts an in-flight connect; the connect() promise then rejects with the sentinel and resets
  // the status to idle (handled above).
  const abortConnect = (id: string) => {
    void cancelConnect(id);
  };

  return { connect, disconnect, abortConnect };
}
