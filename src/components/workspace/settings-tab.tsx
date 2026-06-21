import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useConnectionActions } from "@/components/workspace/use-connection";
import type {
  ConnectionConfig,
  DatabaseNode,
  DbEngine,
} from "@/components/workspace/mock-data";

const ENGINE_LABELS: Record<DbEngine, string> = {
  postgres: "Postgres",
  mysql: "MySQL",
};

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function PasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        id="conn-password"
        type={isVisible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pr-9 font-mono"
      />
      <button
        type="button"
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        onClick={() => setIsVisible((visible) => !visible)}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
}

export function SettingsTab() {
  const { activeNode } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  return <ConnectionForm key={activeNode.id} node={activeNode} />;
}

function ConnectionForm({ node }: { node: DatabaseNode }) {
  const { connections, connectionStatus, renameDatabase } = useWorkspace();
  const { connect, disconnect } = useConnectionActions();
  const { engine, host, port, database, user, password } = node;
  const [form, setForm] = useState<ConnectionConfig>({
    engine,
    host,
    port,
    database,
    user,
    password,
  });
  const nodeId = node.id;
  const isConnected = connections.has(nodeId);
  const isConnecting = connectionStatus.get(nodeId) === "connecting";

  const update = <K extends keyof ConnectionConfig>(
    key: K,
    value: ConnectionConfig[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const isConnectable =
    form.host.length > 0 && form.database.length > 0 && form.user.length > 0;

  return (
    <div className="flex max-w-md flex-col gap-3 p-3">
      <Field label="Name" htmlFor="conn-name">
        <Input
          id="conn-name"
          value={node.name}
          onChange={(event) => renameDatabase(nodeId, event.target.value)}
        />
      </Field>
      <Field label="Type" htmlFor="conn-engine">
        <Select
          value={form.engine}
          onValueChange={(value) => update("engine", value as DbEngine)}
        >
          <SelectTrigger id="conn-engine" className="w-full">
            {ENGINE_LABELS[form.engine]}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="postgres">Postgres</SelectItem>
            <SelectItem value="mysql">MySQL</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Host" htmlFor="conn-host">
        <Input
          id="conn-host"
          value={form.host}
          onChange={(event) => update("host", event.target.value)}
        />
      </Field>
      <div className="flex gap-3">
        <div className="w-28">
          <Field label="Port" htmlFor="conn-port">
            <Input
              id="conn-port"
              value={String(form.port)}
              onChange={(event) =>
                update("port", Number(event.target.value) || 0)
              }
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Database" htmlFor="conn-database">
            <Input
              id="conn-database"
              value={form.database}
              onChange={(event) => update("database", event.target.value)}
            />
          </Field>
        </div>
      </div>
      <Field label="User" htmlFor="conn-user">
        <Input
          id="conn-user"
          value={form.user}
          onChange={(event) => update("user", event.target.value)}
        />
      </Field>
      <Field label="Password" htmlFor="conn-password">
        <PasswordField
          value={form.password}
          onChange={(value) => update("password", value)}
        />
      </Field>
      <div className="flex justify-end">
        {isConnected ? (
          <Button
            type="button"
            onClick={() => disconnect(nodeId)}
            className={cn(
              "bg-red-600 text-white hover:bg-red-700",
              "dark:bg-red-600 dark:hover:bg-red-700",
            )}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => connect(nodeId, form)}
            disabled={isConnecting || !isConnectable}
          >
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        )}
      </div>
    </div>
  );
}
