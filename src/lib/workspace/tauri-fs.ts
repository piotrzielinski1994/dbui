import {
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { FileMap } from "@/lib/workspace/disk-format";
import type { ReadResult, WorkspaceFs, WriteResult } from "@/lib/workspace/fs";
import {
  emptyDirsAfterRemoval,
  parentDir,
  planReconcile,
} from "@/lib/workspace/reconcile";

const MANAGED_FILE =
  /(?:^|\/)folder\.json$|\.db\.json$|^dbui\.workspace\.json$/;

async function toResult<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function collect(
  absDir: string,
  relPrefix: string,
  files: FileMap,
): Promise<void> {
  const entries = await readDir(absDir);
  for (const entry of entries) {
    const relPath = `${relPrefix}${entry.name}`;
    const absPath = `${absDir}/${entry.name}`;
    if (entry.isDirectory) {
      await collect(absPath, `${relPath}/`, files);
      continue;
    }
    if (entry.isFile && MANAGED_FILE.test(relPath)) {
      files[relPath] = await readTextFile(absPath);
    }
  }
}

export function createTauriWorkspaceFs(): WorkspaceFs {
  return {
    readWorkspace: async (rootPath): Promise<ReadResult> => {
      const files: FileMap = {};
      const read = await toResult(collect(rootPath, "", files));
      if (!read.ok) {
        return { ok: false, error: `Failed to read workspace: ${read.error}` };
      }
      return { ok: true, files };
    },
    writeWorkspace: async (rootPath, files): Promise<WriteResult> => {
      const current: FileMap = {};
      // Fresh/unreadable target: treat as empty, write everything.
      await toResult(collect(rootPath, "", current));
      const plan = planReconcile(current, files);
      const written = await toResult(
        (async (): Promise<void> => {
          // Ensure the workspace root itself exists: a root-level file (the
          // manifest) has no parent dir to mkdir, so a fresh/never-created
          // rootPath would otherwise ENOENT on the first write.
          await mkdir(rootPath, { recursive: true });
          for (const [relPath, content] of Object.entries(plan.write)) {
            const dir = parentDir(relPath);
            if (dir !== null) {
              await mkdir(`${rootPath}/${dir}`, { recursive: true });
            }
            await writeTextFile(`${rootPath}/${relPath}`, content);
          }
          for (const relPath of plan.remove) {
            await remove(`${rootPath}/${relPath}`);
          }
          for (const dir of emptyDirsAfterRemoval(files, plan.remove)) {
            await remove(`${rootPath}/${dir}`).catch(() => undefined);
          }
        })(),
      );
      if (!written.ok) {
        return {
          ok: false,
          error: `Failed to write workspace: ${written.error}`,
        };
      }
      return { ok: true };
    },
  };
}
