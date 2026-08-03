import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exiftool } from "exiftool-vendored";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/program.js";
import { SqliteIndex } from "../../src/adapters/sqlite-index.js";
import type { Sidecar } from "../../src/adapters/sidecar-store.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
});

describe("Phase 4 CLI e2e flow", () => {
  it("emits exactly one JSON object on stdout for agent consumption", async () => {
    const root = await indexedRoot();

    const result = await runImg(["--json", "list", root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toHaveLength(1);
    expect(result.json).toMatchObject({ ok: true, status: "success", command: "list" });
  });

  it("stats --json emits a successful JSON object via the Commander action signature", async () => {
    // Regression lock: the `stats` command action MUST use the three-argument
    // Commander signature `(root, _options, command)` so it can read global
    // options via `command.optsWithGlobals()`. A two-argument signature
    // `(root, command)` silently receives the options object as `command` and
    // `--json` is never honored, so `stats --json` would emit human text and
    // fail JSON parsing. This test proves `--json` produces parseable JSON
    // with the stats command/ok contract.
    const root = await indexedRoot();

    const result = await runImg(["--json", "stats", root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toHaveLength(1);
    expect(result.json).toMatchObject({ ok: true, status: "success", command: "stats" });
    const details = result.json.details as { totals: Record<string, number> };
    expect(details.totals).toHaveProperty("images");
    expect(details.totals).toHaveProperty("occurrences");
    expect(details.totals).toHaveProperty("usageEvents");
    expect(details.totals).toHaveProperty("usageRecords");
  });

  it("runs pick, mark-used, list, and stats with stable JSON contracts", async () => {
    const root = await indexedRoot();
    const pick = await runImg([
      "--json",
      "pick",
      root,
      "--category",
      "kitchen-remodeling",
      "--width",
      "100",
      "--height",
      "50",
      "--slot",
      "home.hero",
      "--location",
      "hero"
    ]);

    expect(pick.exitCode).toBe(0);
    expect(pick.json).toMatchObject({ ok: true, command: "pick" });
    expect((pick.json.details as { manifest?: { ranking?: unknown } }).manifest?.ranking).toBeUndefined();

    const mark = await runImg([
      "--json",
      "mark-used",
      root,
      "--sha",
      rootShaFrom(pick.json),
      "--slot",
      "home.card",
      "--location",
      "card-1"
    ]);
    const list = await runImg(["--json", "list", root, "--category", "kitchen-remodeling"]);
    const stats = await runImg(["--json", "stats", root]);

    expect(mark.exitCode).toBe(0);
    expect(list.exitCode).toBe(0);
    expect(stats.exitCode).toBe(0);
    // Structural assertions on the parsed JSON shape, not string substrings.
    const listDetails = list.json.details as {
      images: Array<{
        sha256: string;
        occurrences: string[];
        used: Array<{ slot: string; location: string }>;
      }>;
    };
    expect(listDetails.images).toHaveLength(1);
    const image = listDetails.images[0]!;
    expect(image.sha256).toBe(rootShaFrom(pick.json));
    // pick recorded usage for slot "home.hero"/location "hero", then mark-used
    // recorded slot "home.card"/location "card-1". Both appear in the
    // structural `used` array — assert their presence by slot+location, not
    // via a string substring.
    expect(image.used).toHaveLength(2);
    const usedSlots = image.used.map((u) => `${u.slot}/${u.location}`).sort();
    expect(usedSlots).toEqual(["home.card/card-1", "home.hero/hero"]);

    const statsDetails = stats.json.details as {
      totals: { images: number; occurrences: number; usageEvents: number; usageRecords: number };
    };
    expect(statsDetails.totals.images).toBe(1);
    expect(statsDetails.totals.occurrences).toBe(1);
    expect(statsDetails.totals.usageEvents).toBeGreaterThanOrEqual(1);
    expect(statsDetails.totals.usageRecords).toBeGreaterThanOrEqual(1);
  });

  it("distinguishes pick no-match exit 2 from invalid arguments exit 3", async () => {
    const root = await indexedRoot();

    const noMatch = await runImg([
      "--json",
      "pick",
      root,
      "--category",
      "kitchen-remodeling",
      "--width",
      "9999",
      "--height",
      "9999"
    ]);
    const invalid = await runImg(["--json", "pick", root, "--width", "not-a-number"]);

    expect(noMatch.exitCode).toBe(2);
    expect(noMatch.json).toMatchObject({ ok: false, reason: "no_candidate" });
    expect(invalid.exitCode).toBe(3);
    expect(invalid.json).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it("runs semantic local pick end-to-end with default note and ranking manifest", async () => {
    const root = await semanticIndexedRoot([
      imageFixture("bathroom/dark-sink.jpg", "Dark sink", "Bathroom", "shadow vanity", "bathroom"),
      imageFixture(
        "bathroom/bright-shower.jpg",
        "Bright shower",
        "Bathroom",
        "bright naturally lit shower",
        "bathroom"
      ),
      imageFixture("kitchen/bright-stove.jpg", "Bright stove", "Kitchen", "bright stove", "kitchen")
    ]);

    const result = await runImg([
      "--json",
      "pick",
      root,
      "--category",
      "bathroom",
      "--query",
      "bright shower",
      "--top-k",
      "1"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("defaulted to --semantic local");
    const manifest = result.json.details as {
      manifest?: {
        source?: string;
        ranking?: {
          status?: string;
          mode?: string;
          query?: string;
          topK?: number;
          alternatives?: Array<{ sha256?: string }>;
        };
      };
    };
    expect(manifest.manifest?.source).toBe("bathroom/bright-shower.jpg");
    expect(manifest.manifest?.ranking).toMatchObject({
      status: "ranked",
      mode: "local",
      query: "bright shower",
      topK: 1
    });
    expect(manifest.manifest?.ranking?.alternatives).toHaveLength(1);
  });

  it("runs semantic AI pick with stubbed metadata-only provider payload", async () => {
    const root = await semanticIndexedRoot([
      imageFixture("bathroom/sink.jpg", "Sink", "Bathroom", "small sink", "bathroom"),
      imageFixture("bathroom/shower.jpg", "Shower", "Bathroom", "large bright shower", "bathroom")
    ]);
    const appData = await tempRoot();
    await writeUserConfig(appData, {
      activeProvider: "gemini",
      providers: {
        gemini: {
          provider: "gemini",
          endpoint: "https://ranker.example/v1",
          model: "ranker-test-model",
          apiKey: "test-api-key"
        }
      }
    });
    const requestBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        requestBodies.push(body);
        const parsed = JSON.parse(body) as {
          messages: Array<{ role: string; content: string }>;
        };
        const userPayload = JSON.parse(parsed.messages[1]!.content) as {
          candidates: Array<{ sha256: string; title: string }>;
        };
        const shower = userPayload.candidates.find((candidate) => candidate.title === "Shower")!;
        const sink = userPayload.candidates.find((candidate) => candidate.title === "Sink")!;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    rankings: [
                      { sha256: shower.sha256, score: 0.98, reason: "best bright shower match" },
                      { sha256: sink.sha256, score: 0.4, reason: "weaker sink match" }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        );
      })
    );

    const result = await runImg(
      [
        "--json",
        "pick",
        root,
        "--category",
        "bathroom",
        "--query",
        "bright shower",
        "--semantic",
        "ai",
        "--top-k",
        "1"
      ],
      { APPDATA: appData, XDG_CONFIG_HOME: appData }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).not.toContain("image_url");
    expect(requestBodies[0]).not.toContain("data:image");
    expect(requestBodies[0]).not.toContain("imageBytes");
    expect(requestBodies[0]).not.toContain("bathroom/shower.jpg");
    const manifest = result.json.details as {
      manifest?: { source?: string; ranking?: { mode?: string; reason?: string; alternatives?: unknown[] } };
    };
    expect(manifest.manifest?.source).toBe("bathroom/shower.jpg");
    expect(manifest.manifest?.ranking).toMatchObject({
      mode: "ai",
      reason: "best bright shower match"
    });
    expect(manifest.manifest?.ranking?.alternatives).toHaveLength(1);
  });

  it("surfaces semantic AI provider failures without falling back to local ranking", async () => {
    const root = await semanticIndexedRoot([
      imageFixture("bathroom/sink.jpg", "Sink", "Bathroom", "small sink", "bathroom")
    ]);
    const appData = await tempRoot();
    await writeUserConfig(appData, {
      activeProvider: "gemini",
      providers: {
        gemini: {
          provider: "gemini",
          endpoint: "https://ranker.example/v1",
          model: "ranker-test-model",
          apiKey: "test-api-key"
        }
      }
    });
    const leakedSecret = "sk-pr4reviewwarningredactiontoken000001";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { message: `rate limited Bearer ${leakedSecret}` } }),
            { status: 429 }
          )
      )
    );

    const result = await runImg(
      ["--json", "pick", root, "--category", "bathroom", "--query", "sink", "--semantic", "ai"],
      { APPDATA: appData, XDG_CONFIG_HOME: appData }
    );

    expect(result.exitCode).toBe(4);
    expect(result.json).toMatchObject({
      ok: false,
      status: "failed",
      command: "pick",
      reason: "ai_ranking_failed"
    });
    const failureDetails = result.json.details as
      | { kind?: string; providerDetails?: unknown; manifest?: unknown; ranking?: unknown }
      | undefined;
    expect(failureDetails).toMatchObject({ kind: "RateLimit" });
    expect(failureDetails?.manifest).toBeUndefined();
    expect(failureDetails?.ranking).toBeUndefined();

    const failureText = JSON.stringify(result.json);
    expect(failureText).not.toContain('"ok":true');
    expect(failureText).not.toContain('"manifest"');
    expect(failureText).not.toContain('"ranking"');
    expect(failureText).not.toContain('"mode":"local"');
    expect(failureText).not.toContain("matched local metadata tokens");
    expect(failureText).not.toContain(leakedSecret);
    expect(failureText).toContain("[REDACTED]");
  });

  it("optimizes through the CLI and rejects path traversal without writes", async () => {
    const root = await indexedRoot();

    const optimize = await runImg([
      "--json",
      "optimize",
      root,
      "kitchen/kitchen-001.jpg",
      "--format",
      "webp",
      "--max-width",
      "100"
    ]);

    expect(optimize.exitCode).toBe(0);
    expect(optimize.json).toMatchObject({ ok: true, command: "optimize" });

    // Create an actual outside-root DECODABLE image BEFORE attempting the
    // traversal. The sentinel MUST be a real image (not text) so that if the
    // root/path guard ever regresses, `optimizeService` can still probe/decode
    // the outside file and proceed down the produce path — which would either
    // succeed (writing escape.webp next to it) or fail with a decode/write
    // error whose message does NOT contain the guard's "escapes project root"
    // signature. Asserting that signature plus a byte-for-byte-unchanged
    // sentinel proves the failure is the root/path guard, not a decode fallback.
    //
    // Hermeticity: the outside sentinel lives in a UNIQUE sibling directory of
    // `root` (created fresh per test run) rather than a fixed shared path under
    // `os.tmpdir()`. This keeps it test-owned and outside `root` while
    // preventing concurrent test runs from clobbering each other or overwriting
    // an unrelated temp file. It is registered in `roots` for afterEach cleanup.
    const parentDir = path.dirname(root);
    const outsideDir = await fs.mkdtemp(path.join(parentDir, "smart-image-e2e-escape-"));
    roots.push(outsideDir);
    const outsideJpg = path.join(outsideDir, "escape.jpg");
    const sentinelBytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#7a1f1f" }
    })
      .jpeg()
      .toBuffer();
    await fs.writeFile(outsideJpg, sentinelBytes);

    const escape = await runImg([
      "--json",
      "optimize",
      root,
      path.join("..", path.basename(outsideDir), "escape.jpg"),
      "--format",
      "webp"
    ]);

    expect(escape.exitCode).toBe(5);
    expect(escape.json).toMatchObject({ ok: false, reason: "filesystem_error" });
    // The failure MUST be the root/path guard, not a decode fallback. The
    // guard's error message carries a literal "escapes root" / "escapes
    // project root" signature; a decode failure on the (decodable) sentinel
    // would never produce it. A regressed guard would let probe succeed and
    // the command would proceed to produce — failing this assertion.
    const escapeMessage = String(escape.json.message ?? "");
    expect(escapeMessage).toMatch(/escapes (project )?root/i);
    // The outside file must be byte-for-byte untouched (no write before guard).
    const afterBytes = await fs.readFile(outsideJpg);
    expect(Buffer.compare(afterBytes, sentinelBytes)).toBe(0);
    // No optimized output was produced next to it.
    await expect(fs.stat(path.join(outsideDir, "escape.webp"))).rejects.toThrow();
  });

  it("keeps analyze dry-run failure write-free when provider config is missing", async () => {
    const root = await tempRoot();
    await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } })
      .jpeg()
      .toFile(path.join(root, "raw.jpg"));

    const result = await runImg(["--json", "analyze", root, "--dry-run"]);

    expect(result.exitCode).toBe(3);
    expect(result.json).toMatchObject({ ok: false, reason: "invalid_input" });
    await expect(fs.stat(path.join(root, ".img-ia"))).rejects.toThrow();
  });

  it("keeps project config secret-safe and doctor output redacted", async () => {
    const root = await tempRoot();
    // Controlled user config fixture root. `getUserConfigDir` reads `APPDATA`
    // on Windows and `XDG_CONFIG_HOME` on POSIX, in both cases appending
    // `smart-image-cli`. Point BOTH env vars at the same fixture root so the
    // CLI reads the prepared secret-bearing config on every platform — without
    // this, POSIX would fall back to the throwaway isolated config home and
    // never consume the fixture, making the redaction assertions pass
    // trivially (nothing to leak) instead of proving redaction of real values.
    const appData = await tempRoot();
    await writeUserConfig(appData, {
      activeProvider: "gemini",
      providers: {
        gemini: {
          provider: "gemini",
          endpoint: "https://host.example?api_key=x#refresh_token=y",
          apiKey: "short-key"
        }
      }
    });
    const userConfigEnv = { APPDATA: appData, XDG_CONFIG_HOME: appData };
    // This e2e asserts config redaction, not native ExifTool readiness; stub the
    // probe so full-suite contention cannot make this redaction test time out.
    vi.spyOn(exiftool, "version").mockResolvedValue("12.00");

    const rejected = await runImg(
      [
        "--json",
        "config",
        "set",
        "provider.endpoint",
        "https://host.example?api_key=x",
        "--project",
        "--root",
        root
      ],
      userConfigEnv
    );
    const doctor = await runImg(["--json", "doctor", "--root", root], userConfigEnv);
    const doctorText = JSON.stringify(doctor.json);

    expect(rejected.exitCode).toBe(3);
    expect(rejected.json).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(doctor.exitCode).toBe(5);
    // Prove the fixture was actually consumed: the provider-config check MUST
    // report the activeProvider we wrote ("gemini"). On POSIX without the
    // XDG_CONFIG_HOME override, doctor would read an empty config
    // (activeProvider "ollama") and the redaction assertions below would pass
    // vacuously. This assertion makes fixture consumption deterministic.
    const doctorChecks = (doctor.json.details as { checks?: Array<{ name: string; details?: unknown }> }).checks ?? [];
    const providerConfigCheck = doctorChecks.find((c) => c.name === "provider-config");
    expect(providerConfigCheck).toBeDefined();
    expect(
      (providerConfigCheck?.details as { activeProvider?: string } | undefined)?.activeProvider
    ).toBe("gemini");
    expect(doctorText).not.toContain("api_key=x");
    expect(doctorText).not.toContain("refresh_token=y");
    expect(doctorText).toContain("[REDACTED]");
  });
});

/**
 * Runs the CLI in-process with FULLY isolated config + process state.
 *
 * Concurrency-safety: this helper monkey-patches `process.stdout.write`,
 * `process.exitCode`, and several config-resolving env vars. To stay
 * deterministic under vitest's per-file concurrency it MUST run serialized.
 * The describe block above is intentionally NOT split across files, and every
 * `it` awaits `runImg` to completion before the next starts. If this file is
 * ever parallelized, replace the in-process helper with a child-process spawn
 * that inherits an isolated env instead.
 *
 * Env isolation: on Windows `getUserConfigDir` reads `APPDATA`; on POSIX it
 * reads `XDG_CONFIG_HOME` (falling back to `~/.config`). We force BOTH to a
 * throwaway temp dir so the CLI never reads the real developer's user config,
 * regardless of platform. The original env is captured and restored in a
 * `finally` so a thrown assertion cannot leak real-config reads into later
 * tests.
 */
async function runImg(
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = {}
): Promise<{
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  json: Record<string, unknown>;
}> {
  let stdout = "";
  let stderr = "";
  const originalExitCode = process.exitCode;
  const originalWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  // Capture the full set of env vars `getUserConfigDir` consults so the CLI
  // can never read the real user config on any platform, and so the originals
  // are restored even if the run throws.
  const envKeys = ["APPDATA", "XDG_CONFIG_HOME", "HOME"] as const;
  const originalEnv: Record<string, string | undefined> = {};
  for (const key of envKeys) {
    originalEnv[key] = process.env[key];
  }
  // Isolated config home for this run. The caller may override APPDATA via
  // `env` (e.g. to point at a prepared user config); otherwise we use a
  // throwaway temp dir so no real config is read.
  const isolatedConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-e2e-env-"));
  roots.push(isolatedConfigHome);
  const isolatedEnv: NodeJS.ProcessEnv = {
    APPDATA: env.APPDATA ?? isolatedConfigHome,
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME ?? isolatedConfigHome,
    HOME: env.HOME ?? isolatedConfigHome
  };
  process.exitCode = undefined;
  Object.assign(process.env, isolatedEnv);
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await runCli(["node", "smart-img", ...args]);
    return {
      exitCode: typeof process.exitCode === "number" ? process.exitCode : 0,
      stdout,
      stderr,
      json: JSON.parse(stdout) as Record<string, unknown>
    };
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
    for (const key of envKeys) {
      restoreEnv(key, originalEnv[key]);
    }
  }
}

async function indexedRoot(): Promise<string> {
  const root = await tempRoot();
  const rel = "kitchen/kitchen-001.jpg";
  await fs.mkdir(path.join(root, "kitchen"), { recursive: true });
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "blue" } })
    .jpeg()
    .toFile(path.join(root, rel));
  const bytes = await fs.readFile(path.join(root, rel));
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const sidecar: Sidecar = {
    sha256: sha,
    classification: {
      subject: "Kitchen",
      categories: ["kitchen-remodeling"],
      orientation: "landscape",
      altText: "Kitchen",
      title: "Kitchen",
      description: "Kitchen",
      suggestedSlug: "kitchen"
    },
    dims: { width: 200, height: 100 },
    originalName: "kitchen.jpg",
    model: "test",
    canonicalRelPath: rel,
    occurrences: [rel],
    primaryFlag: "canonicalRelPath"
  };
  await fs.mkdir(path.join(root, ".img-ia", "sidecars"), { recursive: true });
  await fs.writeFile(path.join(root, ".img-ia", "sidecars", `${sha}.json`), `${JSON.stringify(sidecar)}\n`);
  const index = new SqliteIndex(root);
  await index.rebuildFromSidecars([sidecar]);
  index.close();
  return root;
}

type Fixture = {
  rel: string;
  title: string;
  subject: string;
  description: string;
  category: string;
};

function imageFixture(
  rel: string,
  title: string,
  subject: string,
  description: string,
  category: string
): Fixture {
  return { rel, title, subject, description, category };
}

async function semanticIndexedRoot(fixtures: readonly Fixture[]): Promise<string> {
  const root = await tempRoot();
  await fs.mkdir(path.join(root, ".img-ia", "sidecars"), { recursive: true });
  const sidecars: Sidecar[] = [];
  for (const fixture of fixtures) {
    const rel = fixture.rel;
    const fullPath = path.join(root, rel);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await sharp({
      create: { width: 200, height: 100, channels: 3, background: colorFor(rel) }
    })
      .jpeg()
      .toFile(fullPath);
    const bytes = await fs.readFile(fullPath);
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    const sidecar: Sidecar = {
      sha256: sha,
      classification: {
        subject: fixture.subject,
        categories: [fixture.category],
        orientation: "landscape",
        altText: fixture.description,
        title: fixture.title,
        description: fixture.description,
        suggestedSlug: fixture.title.toLowerCase().replace(/\s+/g, "-")
      },
      dims: { width: 200, height: 100 },
      originalName: path.basename(rel),
      model: "test",
      canonicalRelPath: rel,
      occurrences: [rel],
      primaryFlag: "canonicalRelPath"
    };
    sidecars.push(sidecar);
    await fs.writeFile(path.join(root, ".img-ia", "sidecars", `${sha}.json`), `${JSON.stringify(sidecar)}\n`);
  }
  const index = new SqliteIndex(root);
  await index.rebuildFromSidecars(sidecars);
  index.close();
  return root;
}

function colorFor(seed: string): { r: number; g: number; b: number } {
  const bytes = crypto.createHash("sha256").update(seed).digest();
  return { r: bytes[0]!, g: bytes[1]!, b: bytes[2]! };
}

function rootShaFrom(json: Record<string, unknown>): string {
  const details = json.details as { manifest?: { sha256?: string } };
  const sha = details.manifest?.sha256;
  if (sha === undefined) {
    throw new Error("pick manifest did not include sha256");
  }
  return sha;
}

async function writeUserConfig(appData: string, config: unknown): Promise<void> {
  const dir = path.join(appData, "smart-image-cli");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-e2e-"));
  roots.push(root);
  return root;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
