import type { FileMap } from "@/lib/workspace/disk-format";

export type ReadResult =
  | { ok: true; files: FileMap }
  | { ok: false; error: string };

export type WriteResult = { ok: true } | { ok: false; error: string };

export type WorkspaceFs = {
  readWorkspace: (rootPath: string) => Promise<ReadResult>;
  writeWorkspace: (rootPath: string, files: FileMap) => Promise<WriteResult>;
};
