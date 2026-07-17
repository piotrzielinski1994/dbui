import { describe, it, expect } from "vitest";

import { serialize, deserialize } from "@/lib/workspace/disk-format";
import type { FileMap } from "@/lib/workspace/disk-format";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import type { DatabaseNode, QueryResult, TreeNode } from "@/lib/workspace/model";

const EMPTY_RESULT: QueryResult = {
  status: "success",
  timeMs: 0,
  rowCount: 0,
  columns: [],
  rows: [],
  message: "",
};

function pgDatabase(id: string, name: string): DatabaseNode {
  return {
    kind: "database",
    id,
    name,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "app_user",
    password: "app-secret",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    defaultSchema: null,
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    savedJsScripts: [],
    variables: [],
    result: { ...EMPTY_RESULT },
  };
}

const expectDeserializeOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok deserialize, got error: ${result.error}`);
  }
  return result;
};

const PATH = "/tmp/ws";

describe("createInMemoryWorkspaceFs", () => {
  // TC-010 - behavior: read after write returns the written FileMap
  it("should return the written FileMap if read back after a write", async () => {
    const tree: TreeNode[] = [
      { kind: "folder", id: "f1", name: "Users API", children: [pgDatabase("db-1", "app_db")] },
      pgDatabase("db-2", "scratch_db"),
    ];
    const files = serialize(tree);
    const fs = createInMemoryWorkspaceFs({});

    const write = await fs.writeWorkspace(PATH, files);
    expect(write.ok).toBe(true);

    const read = await fs.readWorkspace(PATH);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.files).toEqual(files);

    const reloaded = expectDeserializeOk(deserialize(read.files));
    expect(reloaded.tree.map((node) => node.name).sort()).toEqual(
      ["Users API", "scratch_db"].sort(),
    );
  });

  // TC-010 - behavior: reading an unknown path errors
  it("should return an error result if the path was never written", async () => {
    const fs = createInMemoryWorkspaceFs({});

    const read = await fs.readWorkspace("/tmp/missing");

    expect(read.ok).toBe(false);
  });

  // TC-010 - side-effect-contract: writeWorkspace resolves ok true
  it("should resolve ok true on a successful write", async () => {
    const fs = createInMemoryWorkspaceFs({});
    const files: FileMap = serialize([pgDatabase("db-1", "Solo")]);

    const result = await fs.writeWorkspace(PATH, files);

    expect(result).toEqual({ ok: true });
  });

  // TC-010 - behavior: a pre-seeded workspace reads back its seed
  it("should return the seeded file map if constructed with an initial workspace", async () => {
    const files = serialize([pgDatabase("db-1", "Seeded")]);
    const fs = createInMemoryWorkspaceFs({ [PATH]: files });

    const read = await fs.readWorkspace(PATH);

    expect(read.ok).toBe(true);
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.files).toEqual(files);
  });
});
