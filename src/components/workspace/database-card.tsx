import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { SqlTab } from "@/components/workspace/sql-tab";
import { ViewsTab } from "@/components/workspace/views-tab";
import { ScriptTab } from "@/components/workspace/script-tab";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useConnectionActions } from "@/components/workspace/use-connection";

export function DatabaseCard() {
  const { activeNode, activeDatabaseTab, setDatabaseTab } = useWorkspace();
  useAutoConnect();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  return (
    <Tabs
      value={activeDatabaseTab}
      onValueChange={(value) =>
        setDatabaseTab(value as typeof activeDatabaseTab)
      }
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-9 items-stretch border-b bg-muted/30">
        <TabsList aria-label="Database sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="sql" className={PANE_TABS_TRIGGER}>
            SQL
          </TabsTrigger>
          <TabsTrigger value="views" className={PANE_TABS_TRIGGER}>
            Views
          </TabsTrigger>
          <TabsTrigger value="script" className={PANE_TABS_TRIGGER}>
            Script
          </TabsTrigger>
          <TabsTrigger value="settings" className={PANE_TABS_TRIGGER}>
            Settings
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="sql"
        className="min-h-0 flex-1 data-[state=inactive]:hidden"
      >
        <SqlTab />
      </TabsContent>
      <TabsContent value="views" className="min-h-0 flex-1 overflow-auto">
        <ViewsTab />
      </TabsContent>
      <TabsContent value="script" className="min-h-0 flex-1 overflow-auto">
        <ScriptTab />
      </TabsContent>
      <TabsContent value="settings" className="min-h-0 flex-1 overflow-auto">
        <SettingsTab />
      </TabsContent>
    </Tabs>
  );
}

// Opening a database view auto-connects it (once per node) so the user never has to
// visit Settings and click Connect manually. Skips nodes already connected or in flight.
function useAutoConnect() {
  const { activeNode, connections, connectionStatus } = useWorkspace();
  const { connect } = useConnectionActions();
  const id = activeNode?.kind === "database" ? activeNode.id : null;
  const status = id ? connectionStatus.get(id) : undefined;

  useEffect(() => {
    if (!id || !activeNode || activeNode.kind !== "database") {
      return;
    }
    // Only on first sight this session (status undefined). A manual Disconnect
    // sets "idle", a failure sets "error" - neither should auto-reconnect. A
    // restored connection has a config in the map but no status yet, so it must
    // still fetch its live catalog here (the saved config is not a live session).
    if (status !== undefined) {
      return;
    }
    // Prefer the restored/edited config over the node's seed defaults.
    const saved = connections.get(id);
    connect(
      id,
      saved ?? {
        engine: activeNode.engine,
        host: activeNode.host,
        port: activeNode.port,
        database: activeNode.database,
        user: activeNode.user,
        password: activeNode.password,
      },
    );
    // connect/connections identities change each render; gate on node id + status only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status]);
}
