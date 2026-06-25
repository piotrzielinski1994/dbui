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
} from "@/lib/workspace/model";

const ENGINE_LABELS: Record<DbEngine, string> = {
  postgres: "Postgres",
  mysql: "MySQL",
  sqlite: "SQLite",
};

// The form holds a superset of both connection shapes so switching the engine never loses what
// the user already typed; the live ConnectionConfig is projected per engine at connect time.
type ConnectionForm = {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  file: string;
};

function formFromNode(node: DatabaseNode): ConnectionForm {
  const base = {
    host: "localhost",
    port: 5432,
    database: "",
    user: "",
    password: "",
    file: "",
  };
  if (node.engine === "sqlite") {
    return { ...base, engine: "sqlite", file: node.file };
  }
  return {
    ...base,
    engine: node.engine,
    host: node.host,
    port: node.port,
    database: node.database,
    user: node.user,
    password: node.password,
  };
}

function configFromForm(form: ConnectionForm): ConnectionConfig {
  if (form.engine === "sqlite") {
    return { engine: "sqlite", file: form.file };
  }
  return {
    engine: form.engine,
    host: form.host,
    port: form.port,
    database: form.database,
    user: form.user,
    password: form.password,
  };
}

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
  const { connect, disconnect, abortConnect } = useConnectionActions();
  const [form, setForm] = useState<ConnectionForm>(() => formFromNode(node));
  const nodeId = node.id;
  const isConnected = connections.has(nodeId);
  const isConnecting = connectionStatus.get(nodeId) === "connecting";
  const isSqlite = form.engine === "sqlite";

  const update = <K extends keyof ConnectionForm>(
    key: K,
    value: ConnectionForm[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const isConnectable = isSqlite
    ? form.file.length > 0
    : form.host.length > 0 && form.database.length > 0 && form.user.length > 0;

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
          <SelectContent position="popper">
            <SelectItem value="postgres">Postgres</SelectItem>
            <SelectItem value="mysql">MySQL</SelectItem>
            <SelectItem value="sqlite">SQLite</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {isSqlite ? (
        <Field label="Database file" htmlFor="conn-file">
          <Input
            id="conn-file"
            value={form.file}
            onChange={(event) => update("file", event.target.value)}
            className="font-mono"
            placeholder="/path/to/database.sqlite"
          />
        </Field>
      ) : (
        <>
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
        </>
      )}
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
        ) : isConnecting ? (
          <Button type="button" onClick={() => abortConnect(nodeId)}>
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => connect(nodeId, configFromForm(form))}
            disabled={!isConnectable}
          >
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}
