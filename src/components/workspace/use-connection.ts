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
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { ConnectionConfig } from "@/lib/workspace/model";

export function useConnectionActions() {
  const {
    setConnection,
    setConnectionStatus,
    setDatabaseTables,
    setDatabaseSchema,
    removeConnection,
    updateDatabaseConfig,
    connectionStatus,
  } = useWorkspace();

  const connect = async (id: string, config: ConnectionConfig) => {
    if (connectionStatus.get(id) === "connecting") {
      return;
    }
    setConnectionStatus(id, "connecting");
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
    const tables = result.value;
    setConnection(id, config);
    updateDatabaseConfig(id, config);
    setDatabaseTables(id, tables);
    setConnectionStatus(id, "connected");
    toast.success(`Connected - ${tables.length} tables`);

    // Schema feeds the SQL editor's autocomplete; a failure leaves the connection up with no
    // completion data rather than blocking the connect.
    const schema = await toResult(fetchSchema(id));
    setDatabaseSchema(id, schema.ok ? schema.value : []);
  };

  const disconnect = (id: string) => {
    void disconnectDatabase(id);
    removeConnection(id);
    setConnectionStatus(id, "idle");
  };

  // Aborts an in-flight connect; the connect() promise then rejects with the sentinel and resets
  // the status to idle (handled above).
  const abortConnect = (id: string) => {
    void cancelConnect(id);
  };

  return { connect, disconnect, abortConnect };
}
