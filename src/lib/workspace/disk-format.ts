import type { FolderNode, TreeNode } from "@/lib/workspace/model";
import {
  dehydrateDatabase,
  hydrateDatabase,
  mergeDatabaseFile,
} from "@/lib/workspace/workspace";
import { slugify, uniqueSlug } from "@/lib/workspace/slug";

export type FileMap = Record<string, string>;

export type DeserializeResult =
  | { ok: true; tree: TreeNode[]; skipped: string[] }
  | { ok: false; error: string };

export const MANIFEST = "dbui.workspace.json";

type Ordered = { node: TreeNode; order?: number };

function tryParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function serializeInto(
  files: FileMap,
  nodes: TreeNode[],
  prefix: string,
): void {
  const used = new Set<string>();
  nodes.forEach((node, order) => {
    if (node.kind === "table") {
      return;
    }
    const slug = uniqueSlug(slugify(node.name), used);
    if (node.kind === "folder") {
      const dir = `${prefix}${slug}`;
      files[`${dir}/folder.json`] = JSON.stringify(
        { id: node.id, name: node.name, order },
        null,
        2,
      );
      serializeInto(files, node.children, `${dir}/`);
      return;
    }
    files[`${prefix}${slug}.db.json`] = JSON.stringify(
      { ...dehydrateDatabase(node), order },
      null,
      2,
    );
  });
}

export function serialize(
  tree: TreeNode[],
  workspaceName = "Workspace",
): FileMap {
  const files: FileMap = {
    [MANIFEST]: JSON.stringify(
      { schemaVersion: 1, name: workspaceName },
      null,
      2,
    ),
  };
  serializeInto(files, tree, "");
  return files;
}

function parseDatabase(files: FileMap, path: string): Ordered | null {
  const parsed = tryParse<Record<string, unknown>>(files[path]);
  if (parsed === undefined) {
    return null;
  }
  // A file lacking an `id` falls back to the path-derived (deterministic) id, so a hand-authored
  // file still loads with a stable-per-path identity (less stable than an in-file uuid on rename).
  const withId =
    typeof parsed.id === "string"
      ? parsed
      : { ...parsed, id: path.replace(/\.db\.json$/, "") };
  const merged = mergeDatabaseFile(withId);
  if (merged === null) {
    return null;
  }
  const order =
    typeof parsed.order === "number" ? parsed.order : undefined;
  return { order, node: hydrateDatabase(merged) };
}

function buildLevel(
  files: FileMap,
  prefix: string,
  skipped: string[],
): TreeNode[] {
  const databasePaths: string[] = [];
  const subdirs = new Set<string>();

  for (const path of Object.keys(files)) {
    if (path === MANIFEST || !path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex === -1) {
      if (rest.endsWith(".db.json")) {
        databasePaths.push(path);
      }
      continue;
    }
    subdirs.add(rest.slice(0, slashIndex));
  }

  const databases = databasePaths.flatMap<Ordered>((path) => {
    const entry = parseDatabase(files, path);
    if (!entry) {
      skipped.push(path);
      return [];
    }
    return [entry];
  });

  const folders = [...subdirs].flatMap<Ordered>((segment) => {
    const dir = `${prefix}${segment}`;
    const folderJsonPath = `${dir}/folder.json`;
    const raw = files[folderJsonPath];
    const parsed =
      raw === undefined
        ? undefined
        : tryParse<Record<string, unknown>>(raw);
    if (raw !== undefined && parsed === undefined) {
      skipped.push(folderJsonPath);
      return [];
    }
    const id =
      parsed && typeof parsed.id === "string" ? parsed.id : dir;
    const name =
      parsed && typeof parsed.name === "string" ? parsed.name : segment;
    const order =
      parsed && typeof parsed.order === "number" ? parsed.order : undefined;
    const folder: FolderNode = {
      kind: "folder",
      id,
      name,
      children: buildLevel(files, `${dir}/`, skipped),
    };
    return [{ order, node: folder }];
  });

  return sortOrdered([...databases, ...folders]);
}

function sortOrdered(entries: Ordered[]): TreeNode[] {
  return [...entries]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const orderA = a.entry.order ?? a.index;
      const orderB = b.entry.order ?? b.index;
      return orderA - orderB;
    })
    .map(({ entry }) => entry.node);
}

export function deserialize(files: FileMap): DeserializeResult {
  if (files[MANIFEST] === undefined) {
    return { ok: false, error: `Not a workspace: missing ${MANIFEST}` };
  }
  const skipped: string[] = [];
  const tree = buildLevel(files, "", skipped);
  return { ok: true, tree, skipped };
}
