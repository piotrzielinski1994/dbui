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
  mongodb: "MongoDB",
};

// The form holds a superset of every connection shape so switching the engine never loses what
// the user already typed; the live ConnectionConfig is projected per engine at connect time.
// `uri` is the mongodb-only connection-string override.
type ConnectionForm = {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  file: string;
  uri: string;
};

function formFromNode(node: DatabaseNode): ConnectionForm {
  const base = {
    host: "localhost",
    port: 5432,
    database: "",
    user: "",
    password: "",
    file: "",
    uri: "",
  };
  if (node.engine === "sqlite") {
    return { ...base, engine: "sqlite", file: node.file };
  }
  if (node.engine === "mongodb") {
    return {
      ...base,
      engine: "mongodb",
      host: node.host,
      port: node.port,
      database: node.database,
      user: node.user,
      password: node.password,
      uri: node.uri ?? "",
    };
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
  if (form.engine === "mongodb") {
    return {
      engine: "mongodb",
      host: form.host,
      port: form.port,
      database: form.database,
      user: form.user,
      password: form.password,
      ...(form.uri.trim() ? { uri: form.uri } : {}),
    };
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

// Accept #rrggbb or #rrggbbaa - the optional alpha pair lets the user dial the border's opacity
// (e.g. #dc262640 = faint red) instead of a fixed blend.
const HEX_COLOR = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

// Presets carry a 50% alpha (`80`) so the recoloured borders read as a tint by default; the user
// can still type any #rrggbb(aa) for full control.
const ACCENT_PRESETS: { label: string; value: string | null }[] = [
  { label: "None", value: null },
  { label: "Green", value: "#16a34a80" },
  { label: "Blue", value: "#2563eb80" },
  { label: "Red", value: "#dc262680" },
];

function AccentField({
  nodeId,
  accentColor,
}: {
  nodeId: string;
  accentColor: string | null;
}) {
  const { setDatabaseAccent } = useWorkspace();
  const [hex, setHex] = useState(accentColor ?? "");

  // Keep the hex text field in sync when the accent changes from outside this field (a preset
  // swatch or the native picker); typing into the field drives the accent the other way. Sync
  // during render (React's "adjust state on prop change" pattern) rather than in an effect, so it
  // never schedules a cascading post-render re-render.
  const [prevAccent, setPrevAccent] = useState(accentColor);
  if (accentColor !== prevAccent) {
    setPrevAccent(accentColor);
    setHex(accentColor ?? "");
  }

  const onHexChange = (value: string) => {
    setHex(value);
    if (value.length === 0) {
      setDatabaseAccent(nodeId, null);
      return;
    }
    if (HEX_COLOR.test(value)) {
      setDatabaseAccent(nodeId, value.toLowerCase());
    }
  };

  return (
    <Field label="Accent color" htmlFor="conn-accent-hex">
      {/* One flush control group: preset swatches, the native picker, and the hex input all share
          edges (no gaps) and one height (h-9). Each control after the first drops its left border so
          neighbours collapse into a single 1px divider. */}
      <div className="flex items-stretch">
        {ACCENT_PRESETS.map((preset) => {
          const isActive = accentColor === preset.value;
          return (
            <button
              key={preset.label}
              type="button"
              aria-label={preset.label}
              aria-pressed={isActive}
              onClick={() => setDatabaseAccent(nodeId, preset.value)}
              style={preset.value ? { backgroundColor: preset.value } : undefined}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center border border-l-0 border-border text-[10px] first:border-l",
                // relative+z so the active swatch's ring draws over its flush neighbours instead
                // of being clipped by them on the shared (left/right) edges.
                isActive && "relative z-10 ring-1 ring-foreground",
                !preset.value && "bg-transparent text-muted-foreground",
              )}
            >
              {preset.value ? null : "/"}
            </button>
          );
        })}
        <input
          type="color"
          aria-label="Accent color picker"
          // The native picker has no alpha channel; show the RGB part and keep the user's chosen
          // alpha pair when they nudge the hue.
          value={accentColor ? accentColor.slice(0, 7) : "#000000"}
          onChange={(event) =>
            setDatabaseAccent(
              nodeId,
              event.target.value.toLowerCase() +
                (accentColor && accentColor.length === 9
                  ? accentColor.slice(7)
                  : ""),
            )
          }
          className="h-9 w-9 shrink-0 cursor-pointer border border-l-0 border-border bg-transparent p-1"
        />
        <Input
          id="conn-accent-hex"
          aria-label="Hex"
          value={hex}
          onChange={(event) => onHexChange(event.target.value)}
          placeholder="#rrggbb(aa)"
          className="h-9 flex-1 rounded-none border-l-0 font-mono"
        />
      </div>
    </Field>
  );
}

// Per-database Read-only toggle: an accessible square switch (role="switch") that blocks every
// write path to this database (table mutations + write-shaped SQL) when on. A prod safety cue,
// paired with the accent color. Square, theme-token colored - obeys design.md (no rounded corners).
function ReadOnlyField({
  nodeId,
  readOnly,
}: {
  nodeId: string;
  readOnly: boolean;
}) {
  const { setDatabaseReadOnly } = useWorkspace();
  return (
    <Field label="Read-only" htmlFor="conn-readonly">
      <div className="flex items-center gap-2">
        <button
          id="conn-readonly"
          type="button"
          role="switch"
          aria-checked={readOnly}
          onClick={() => setDatabaseReadOnly(nodeId, !readOnly)}
          className={cn(
            "relative flex h-5 w-9 shrink-0 items-center border border-border transition-colors",
            readOnly ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "block size-4 transition-transform",
              readOnly
                ? "translate-x-4 bg-primary-foreground"
                : "translate-x-0.5 bg-foreground",
            )}
          />
        </button>
        <span className="text-xs text-muted-foreground">
          Block all writes to this database
        </span>
      </div>
    </Field>
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
  const isMongo = form.engine === "mongodb";

  const update = <K extends keyof ConnectionForm>(
    key: K,
    value: ConnectionForm[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const isConnectable = (() => {
    if (isSqlite) {
      return form.file.length > 0;
    }
    // Mongo connects with EITHER a non-empty uri (which overrides everything) OR host + database.
    if (isMongo) {
      return form.uri.trim().length > 0 || (form.host.length > 0 && form.database.length > 0);
    }
    return form.host.length > 0 && form.database.length > 0 && form.user.length > 0;
  })();

  return (
    <div className="flex max-w-md flex-col gap-3 p-3">
      <Field label="Name" htmlFor="conn-name">
        <Input
          id="conn-name"
          value={node.name}
          onChange={(event) => renameDatabase(nodeId, event.target.value)}
        />
      </Field>
      <AccentField nodeId={nodeId} accentColor={node.accentColor} />
      <ReadOnlyField nodeId={nodeId} readOnly={node.readOnly} />
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
            <SelectItem value="mongodb">MongoDB</SelectItem>
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
          {isMongo ? (
            <Field
              label="Connection string (overrides fields)"
              htmlFor="conn-uri"
            >
              <Input
                id="conn-uri"
                aria-label="Connection string"
                value={form.uri}
                onChange={(event) => update("uri", event.target.value)}
                className="font-mono"
                placeholder="mongodb+srv://..."
              />
            </Field>
          ) : null}
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
