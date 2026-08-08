import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PixabayUsedIds, writeAllBytes } from "../../src/adapters/pixabay-used-ids.js";
import { StorageRootGuardError } from "../../src/adapters/storage-root-guard.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("PixabayUsedIds", () => {
  it("path is root-contained; append/read keeps latest id→sha; duplicate append is idempotent", async () => {
    const root = await tempRoot();
    const store = new PixabayUsedIds({ root });

    expect(store.path).toBe(path.join(root, ".img-ia", "pixabay", "used-ids.jsonl"));
    expect(path.resolve(store.path).startsWith(path.resolve(root) + path.sep)).toBe(true);

    expect(await store.readMap()).toEqual(new Map());

    await store.append(101, SHA_A);
    await store.append(202, SHA_B);
    expect(await store.readMap()).toEqual(
      new Map([
        [101, SHA_A],
        [202, SHA_B]
      ])
    );

    // Same id+sha again is idempotent (no extra durable meaning; map unchanged).
    await store.append(101, SHA_A);
    expect(await store.readMap()).toEqual(
      new Map([
        [101, SHA_A],
        [202, SHA_B]
      ])
    );

    // Later mapping for the same id wins (index, not tombstone history).
    await store.append(101, SHA_C);
    expect(await store.readMap()).toEqual(
      new Map([
        [101, SHA_C],
        [202, SHA_B]
      ])
    );

    const raw = await fs.readFile(store.path, "utf8");
    const lines = raw.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const row = JSON.parse(line) as { id: number; sha256: string };
      expect(typeof row.id).toBe("number");
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/i);
      expect(Object.keys(row).sort()).toEqual(["id", "sha256"]);
    }
  });

  it("missing file and malformed/torn lines self-heal; only valid id→sha rows remain", async () => {
    const root = await tempRoot();
    const store = new PixabayUsedIds({ root });

    expect(await store.readMap()).toEqual(new Map());

    await fs.mkdir(path.dirname(store.path), { recursive: true });
    await fs.writeFile(
      store.path,
      [
        "",
        "not-json",
        "{",
        JSON.stringify({ id: "nope", sha256: SHA_A }),
        JSON.stringify({ id: 1, sha256: "short" }),
        JSON.stringify({ id: -3, sha256: SHA_A }),
        JSON.stringify({ id: 1.5, sha256: SHA_A }),
        JSON.stringify({ sha256: SHA_A }),
        JSON.stringify({ id: 7 }),
        JSON.stringify({ id: 7, sha256: SHA_A, extra: "drop-me" }),
        JSON.stringify({ id: 9, sha256: SHA_B }),
        JSON.stringify({ id: 7, sha256: SHA_C }),
        "partial-line-without-newline"
      ].join("\n"),
      "utf8"
    );

    // Valid: id 7 latest→SHA_C, id 9→SHA_B. Extra fields ignored if id+sha valid.
    expect(await store.readMap()).toEqual(
      new Map([
        [7, SHA_C],
        [9, SHA_B]
      ])
    );

    await store.append(11, SHA_A);
    const after = await store.readMap();
    expect(after.get(7)).toBe(SHA_C);
    expect(after.get(9)).toBe(SHA_B);
    expect(after.get(11)).toBe(SHA_A);
    expect(after.size).toBe(3);
  });

  it("writes are durable under root at 0600, secret-free, and reject invalid inputs", async () => {
    const root = await tempRoot();
    const store = new PixabayUsedIds({ root });

    await store.append(42, SHA_A);
    const stat = await fs.stat(store.path);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }

    const body = await fs.readFile(store.path, "utf8");
    expect(body).not.toMatch(/[?&]key=/i);
    expect(body).not.toMatch(/api[_-]?key/i);
    expect(body).not.toContain("PIXABAY");
    expect(body).toContain(SHA_A);
    expect(body).toContain('"id":42');

    // No leftover temp siblings after a successful append.
    const dir = path.dirname(store.path);
    const names = await fs.readdir(dir);
    expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(names).toContain("used-ids.jsonl");

    await expect(store.append(0, SHA_A)).rejects.toThrow(/id/i);
    await expect(store.append(-1, SHA_A)).rejects.toThrow(/id/i);
    await expect(store.append(1.2, SHA_A)).rejects.toThrow(/id/i);
    await expect(store.append(1, "not-a-sha")).rejects.toThrow(/sha256/i);
    await expect(store.append(1, "A".repeat(63))).rejects.toThrow(/sha256/i);

    // Non-directory root cannot host `.img-ia/...`; append fails without leaking secrets.
    const fileRoot = path.join(root, "not-a-dir");
    await fs.writeFile(fileRoot, "x", "utf8");
    const bad = new PixabayUsedIds({ root: fileRoot });
    await expect(bad.append(1, SHA_A)).rejects.toThrow();
    try {
      await bad.append(2, SHA_B);
      expect.unreachable("append on file-root must fail");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect(String(error)).not.toMatch(/[?&]key=/i);
      if (error instanceof StorageRootGuardError) {
        expect(error.name).toBe("StorageRootGuardError");
      }
    }
  });

  it("writeAllBytes retries short writes fully and rejects zero-progress writes", async () => {
    const payload = Buffer.from(`${JSON.stringify({ id: 99, sha256: SHA_A })}\n`, "utf8");
    const chunks: Buffer[] = [];
    let calls = 0;
    await writeAllBytes(async (buffer, offset = 0, length = buffer.length - offset) => {
      calls += 1;
      const take = Math.min(5, length);
      chunks.push(Buffer.from(buffer.subarray(offset, offset + take)));
      return { bytesWritten: take };
    }, payload);
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
    expect(calls).toBe(Math.ceil(payload.length / 5));
    await expect(writeAllBytes(async () => ({ bytesWritten: 0 }), payload)).rejects.toThrow(
      /progress|bytesWritten/i
    );
    await expect(writeAllBytes(async () => ({ bytesWritten: -1 }), payload)).rejects.toThrow(
      /progress|bytesWritten/i
    );
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pixabay-used-ids-"));
  roots.push(root);
  return root;
}
