import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake the @tauri-apps/plugin-fs surface tauri-fs.ts uses. The fake models a real
// filesystem closely enough to reproduce the "parent dir must exist before write"
// failure: writeTextFile into a dir that was never mkdir-ed throws ENOENT.

const dirs = new Set<string>();
const fileContents = new Map<string, string>();

class Enoent extends Error {
  constructor(path: string) {
    super(`No such file or directory (os error 2): ${path}`);
  }
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// readDir models a real directory listing over the fake fileContents/dirs: it returns the immediate
// children (files + subdirs) of the queried absolute dir, so collect()'s recursion is exercised.
function readDirEntries(absDir: string) {
  const prefix = `${absDir}/`;
  const files = new Set<string>();
  const subdirs = new Set<string>();
  for (const path of fileContents.keys()) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      files.add(rest);
    } else {
      subdirs.add(rest.slice(0, slash));
    }
  }
  return [
    ...[...files].map((name) => ({
      name,
      isFile: true,
      isDirectory: false,
    })),
    ...[...subdirs].map((name) => ({
      name,
      isFile: false,
      isDirectory: true,
    })),
  ];
}

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn((path: string) => {
    const parts = path.split("/");
    for (let i = parts.length; i > 0; i -= 1) {
      dirs.add(parts.slice(0, i).join("/"));
    }
    return Promise.resolve();
  }),
  writeTextFile: vi.fn((path: string, content: string) => {
    if (!dirs.has(dirOf(path))) {
      return Promise.reject(new Enoent(path));
    }
    fileContents.set(path, content);
    return Promise.resolve();
  }),
  readTextFile: vi.fn((path: string) => {
    const content = fileContents.get(path);
    return content === undefined
      ? Promise.reject(new Enoent(path))
      : Promise.resolve(content);
  }),
  readDir: vi.fn((path: string) => Promise.resolve(readDirEntries(path))),
  remove: vi.fn((path: string) => {
    fileContents.delete(path);
    dirs.delete(path);
    return Promise.resolve();
  }),
  stat: vi.fn(() => Promise.resolve({ isFile: true, isDirectory: false })),
}));

import { createTauriWorkspaceFs } from "@/lib/workspace/tauri-fs";

const ROOT = "/app/data/workspace";

beforeEach(() => {
  dirs.clear();
  fileContents.clear();
  // The app data dir itself exists; the `workspace` subfolder does NOT yet.
  dirs.add("");
  dirs.add("/app");
  dirs.add("/app/data");
});

describe("createTauriWorkspaceFs writeWorkspace", () => {
  // AC-010 - behavior: a fresh root dir is created before the manifest is written
  it("should create the root dir before writing the manifest into a fresh path", async () => {
    const fs = createTauriWorkspaceFs();

    const result = await fs.writeWorkspace(ROOT, {
      "dbui.workspace.json": "{}",
      "dir1/folder.json": "{}",
    });

    expect(result.ok).toBe(true);
    expect(fileContents.get(`${ROOT}/dbui.workspace.json`)).toBe("{}");
    expect(fileContents.get(`${ROOT}/dir1/folder.json`)).toBe("{}");
  });

  // AC-008 - behavior: a second write removes the managed file the new tree dropped
  it("should remove a managed file that the next write no longer contains", async () => {
    const fs = createTauriWorkspaceFs();

    await fs.writeWorkspace(ROOT, {
      "dbui.workspace.json": "{}",
      "gone.db.json": '{"id":"g"}',
      "stay.db.json": '{"id":"s"}',
    });
    expect(fileContents.get(`${ROOT}/gone.db.json`)).toBe('{"id":"g"}');

    await fs.writeWorkspace(ROOT, {
      "dbui.workspace.json": "{}",
      "stay.db.json": '{"id":"s"}',
    });

    expect(fileContents.has(`${ROOT}/gone.db.json`)).toBe(false);
    expect(fileContents.get(`${ROOT}/stay.db.json`)).toBe('{"id":"s"}');
  });
});

describe("createTauriWorkspaceFs readWorkspace", () => {
  // AC-004 - behavior: read recursively collects the managed files (skipping unmanaged ones)
  it("should collect managed files recursively and skip unmanaged files", async () => {
    dirs.add(ROOT);
    dirs.add(`${ROOT}/dir1`);
    fileContents.set(`${ROOT}/dbui.workspace.json`, '{"schemaVersion":1}');
    fileContents.set(`${ROOT}/root.db.json`, '{"id":"r"}');
    fileContents.set(`${ROOT}/dir1/folder.json`, '{"id":"f"}');
    fileContents.set(`${ROOT}/dir1/nested.db.json`, '{"id":"n"}');
    fileContents.set(`${ROOT}/notes.txt`, "scratch");

    const fs = createTauriWorkspaceFs();
    const read = await fs.readWorkspace(ROOT);

    expect(read.ok).toBe(true);
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.files).toEqual({
      "dbui.workspace.json": '{"schemaVersion":1}',
      "root.db.json": '{"id":"r"}',
      "dir1/folder.json": '{"id":"f"}',
      "dir1/nested.db.json": '{"id":"n"}',
    });
    expect(read.files).not.toHaveProperty("notes.txt");
  });
});
