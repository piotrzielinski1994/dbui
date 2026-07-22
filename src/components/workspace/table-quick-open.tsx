import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pziel/pureui";
import { Database, Folder, Table } from "lucide-react";
import {
  type QuickOpenEntry,
  scoreQuickOpen,
} from "@/lib/workspace/quick-open";

type TableQuickOpenProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly QuickOpenEntry[];
  onSelect: (id: string) => void;
};

const KIND_ICON = {
  database: Database,
  folder: Folder,
  table: Table,
} as const;

// cmdk owns the filtering + highlight so Enter selects the top-ranked row. It
// calls this per item with the item's `value` (the node id) and `keywords`
// ([name, breadcrumb, schema]); we rank via the shared scorer. An empty search
// shows every row (score 1).
const quickOpenFilter = (
  _value: string,
  search: string,
  keywords?: string[],
): number => {
  if (search === "") {
    return 1;
  }
  const [name = "", breadcrumb = "", schema = ""] = keywords ?? [];
  return scoreQuickOpen(search, { name, breadcrumb, schema });
};

export function TableQuickOpen({
  open,
  onOpenChange,
  entries,
  onSelect,
}: TableQuickOpenProps) {
  const select = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      filter={quickOpenFilter}
    >
      <CommandInput placeholder="Search tables…" />
      <CommandList>
        <CommandEmpty>No matching objects</CommandEmpty>
        {entries.map((entry) => {
          const Icon = KIND_ICON[entry.kind];
          return (
            <CommandItem
              key={entry.id}
              value={entry.id}
              keywords={[entry.name, entry.breadcrumb, entry.schema ?? ""]}
              onSelect={() => select(entry.id)}
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span>{entry.name}</span>
              {entry.breadcrumb !== "" && (
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {`in ${entry.breadcrumb}`}
                </span>
              )}
            </CommandItem>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
