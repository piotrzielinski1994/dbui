import type { FileMap } from "@/lib/workspace/disk-format";

const MANAGED_FILE =
  /(?:^|\/)folder\.json$|\.db\.json$|^dbui\.workspace\.json$/;

export type ReconcilePlan = { write: FileMap; remove: string[] };

export function planReconcile(current: FileMap, next: FileMap): ReconcilePlan {
  const write: FileMap = {};
  for (const [path, content] of Object.entries(next)) {
    if (current[path] !== content) {
      write[path] = content;
    }
  }
  const isRemovable = (path: string): boolean => {
    if (path in next) {
      return false;
    }
    return MANAGED_FILE.test(path);
  };
  const remove = Object.keys(current).filter(isRemovable);
  return { write, remove };
}

export function parentDir(relPath: string): string | null {
  const slash = relPath.lastIndexOf("/");
  return slash === -1 ? null : relPath.slice(0, slash);
}

function ancestorDirs(relPath: string): string[] {
  const dirs: string[] = [];
  let dir = parentDir(relPath);
  while (dir !== null) {
    dirs.push(dir);
    dir = parentDir(dir);
  }
  return dirs;
}

export function emptyDirsAfterRemoval(
  next: FileMap,
  removed: string[],
): string[] {
  const surviving = new Set(
    Object.keys(next).flatMap((path) => ancestorDirs(path)),
  );
  const candidates = new Set(removed.flatMap((path) => ancestorDirs(path)));
  return [...candidates]
    .filter((dir) => !surviving.has(dir))
    .sort((a, b) => b.length - a.length);
}
