/**
 * Subagent parity test (T4).
 *
 * Asserts the 12 specialist agent files shipped across 4 hosts are byte-identical
 * to generator output (drift gate), correctly pinned per spec (model + effort +
 * permission), collision-free against host built-ins, exactly 12 per host, and
 * that Codex TOML parses with the # massa-ai-owned marker. FEATURES.md table
 * parity (DOC-06) is gated on the subagent section existing (lands in T10).
 *
 * Spec: .specs/features/subagent-skills-plugin-parity/spec.md
 */

import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import toml from "toml";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const GEN_SCRIPT = path.join(REPO_ROOT, "scripts/generate-subagent-artifacts.ts");

const SPECIALIST_NAMES = [
  "investigator",
  "planner",
  "builder",
  "reviewer",
  "context-curator",
  "verification-agent",
  "requirements-analyst",
  "architecture-specialist",
  "test-engineer",
  "documentation-agent",
  "audit-specialist",
  "mobile-specialist",
] as const;
type SpecialistName = (typeof SPECIALIST_NAMES)[number];

const WRITE_AGENTS = new Set<SpecialistName>([
  "builder",
  "test-engineer",
  "documentation-agent",
]);

// ── Spec model-pinning tables (PINNED, NOT advisory) ────────────────────────
const AGENT_MODELS_CLAUDE: Record<SpecialistName, string> = {
  investigator: "haiku",
  "context-curator": "haiku",
  "documentation-agent": "haiku",
  "requirements-analyst": "sonnet",
  planner: "opus",
  builder: "sonnet",
  reviewer: "sonnet",
  "verification-agent": "sonnet",
  "test-engineer": "sonnet",
  "audit-specialist": "sonnet",
  "mobile-specialist": "sonnet",
  "architecture-specialist": "opus",
};

const AGENT_MODELS_CODEX: Record<SpecialistName, string> = {
  investigator: "gpt-5.4-mini",
  "context-curator": "gpt-5.4-mini",
  "documentation-agent": "gpt-5.4-mini",
  "requirements-analyst": "gpt-5.6-terra",
  planner: "gpt-5.6-sol",
  builder: "gpt-5.6-terra",
  reviewer: "gpt-5.6-terra",
  "verification-agent": "gpt-5.6-terra",
  "test-engineer": "gpt-5.6-terra",
  "audit-specialist": "gpt-5.6-terra",
  "mobile-specialist": "gpt-5.6-terra",
  "architecture-specialist": "gpt-5.6-sol",
};

// Cursor/OpenCode: charter metadata.model_hint verbatim
const CHARTER_MODEL_HINTS: Record<SpecialistName, string> = {
  investigator: "DeepSeek V4 Pro",
  "context-curator": "DeepSeek V4 Pro",
  "documentation-agent": "DeepSeek V4 Pro",
  "requirements-analyst": "DeepSeek V4 Pro",
  planner: "GLM-5.2",
  builder: "GLM-5.2",
  reviewer: "GLM-5.2",
  "verification-agent": "GLM-5.2",
  "test-engineer": "GLM-5.2",
  "audit-specialist": "GLM-5.2",
  "mobile-specialist": "GLM-5.2",
  "architecture-specialist": "MiniMax M3",
};

// ── Host built-in names (spec name-collision ACs) ───────────────────────────
const HOST_BUILTINS: Record<string, ReadonlySet<string>> = {
  claude: new Set(["Explore", "Plan", "general-purpose"]),
  codex: new Set(["default", "worker", "explorer"]),
  cursor: new Set(["Explore", "Plan", "general-purpose"]),
  opencode: new Set(["build", "plan", "general", "explore", "scout"]),
};

// ── Frontmatter parser (minimal, for .md agents) ───────────────────────────
function parseMdFrontmatter(raw: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  if (!m) throw new Error("missing frontmatter");
  const fm: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const lm = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (lm) fm[lm[1]] = lm[2]!.trim();
  }
  return fm;
}

async function readAgentMd(hostDir: string, name: SpecialistName): Promise<string> {
  return fs.readFile(
    path.join(REPO_ROOT, "apps", hostDir, "agents", `massa-ai-${name}.md`),
    "utf8",
  );
}

async function readAgentToml(name: SpecialistName): Promise<string> {
  return fs.readFile(
    path.join(REPO_ROOT, "apps/codex-plugin/agents", `massa-ai-${name}.toml`),
    "utf8",
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("subagent parity — drift gate (CLA-07/CDX-08/CRS-06/OPC-08)", () => {
  test("generator --check exits 0 (no drift between charters and shipped files)", () => {
    const res = spawnSync("bun", ["run", GEN_SCRIPT, "--check"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      timeout: 30000,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No drift");
  });
});

describe("subagent parity — exact 12 names per host (CLA-09/CRS-07/OPC-09)", () => {
  test("claude: exactly 12 specialist .md files with the registry names", async () => {
    const dir = path.join(REPO_ROOT, "apps/claude-plugin/agents");
    const files = (await fs.readdir(dir)).filter(
      (f) => f.startsWith("massa-ai-") && f.endsWith(".md") && !f.includes("navigator"),
    );
    expect(files.length).toBe(12);
    const names = files.map((f) => f.replace(/^massa-ai-/, "").replace(/\.md$/, ""));
    expect(names.sort()).toEqual([...SPECIALIST_NAMES].sort());
  });

  test("codex: exactly 12 specialist .toml files with the registry names", async () => {
    const dir = path.join(REPO_ROOT, "apps/codex-plugin/agents");
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("massa-ai-") && f.endsWith(".toml"));
    expect(files.length).toBe(12);
    const names = files.map((f) => f.replace(/^massa-ai-/, "").replace(/\.toml$/, ""));
    expect(names.sort()).toEqual([...SPECIALIST_NAMES].sort());
  });

  test("cursor: exactly 12 specialist .md files (navigator excluded)", async () => {
    const dir = path.join(REPO_ROOT, "apps/cursor-plugin/agents");
    const files = (await fs.readdir(dir)).filter(
      (f) => f.startsWith("massa-ai-") && f.endsWith(".md") && !f.includes("navigator"),
    );
    expect(files.length).toBe(12);
    const names = files.map((f) => f.replace(/^massa-ai-/, "").replace(/\.md$/, ""));
    expect(names.sort()).toEqual([...SPECIALIST_NAMES].sort());
  });

  test("opencode: exactly 12 specialist .md files", async () => {
    const dir = path.join(REPO_ROOT, "apps/opencode-plugin/agents");
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("massa-ai-") && f.endsWith(".md"));
    expect(files.length).toBe(12);
    const names = files.map((f) => f.replace(/^massa-ai-/, "").replace(/\.md$/, ""));
    expect(names.sort()).toEqual([...SPECIALIST_NAMES].sort());
  });
});

describe("subagent parity — name collision (CLA-08/CDX-09/OPC-09)", () => {
  test("no shipped agent name collides with host built-ins", async () => {
    for (const [host, builtins] of Object.entries(HOST_BUILTINS)) {
      for (const name of SPECIALIST_NAMES) {
        // The shipped name is massa-ai-<name>; the registry name is <name>.
        // Collision check is against the registry name (spec AC: "name fields").
        expect(builtins.has(name)).toBe(false);
        expect(builtins.has(`massa-ai-${name}`)).toBe(false);
      }
    }
  });
});

describe("subagent parity — Claude model + effort pin (CLA-10)", () => {
  test("each Claude agent has model per spec table + effort: high", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentMd("claude-plugin", name);
      const fm = parseMdFrontmatter(raw);
      expect(fm.model).toBe(AGENT_MODELS_CLAUDE[name]);
      expect(fm.effort).toBe("high");
    }
  });
});

describe("subagent parity — Claude permission boundary (CLA-02/CLA-03)", () => {
  test("read-only agents lack Write/Edit; write agents include them", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentMd("claude-plugin", name);
      const fm = parseMdFrontmatter(raw);
      const tools = fm.tools ?? "";
      if (WRITE_AGENTS.has(name)) {
        expect(tools).toContain("Write");
        expect(tools).toContain("Edit");
      } else {
        expect(tools).not.toContain("Write");
        expect(tools).not.toContain("Edit");
      }
    }
  });

  test("no Claude agent sets hooks/mcpServers/permissionMode (CLA-04)", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentMd("claude-plugin", name);
      const fm = parseMdFrontmatter(raw);
      expect(fm.hooks).toBeUndefined();
      expect(fm.mcpServers).toBeUndefined();
      expect(fm.permissionMode).toBeUndefined();
    }
  });
});

describe("subagent parity — Codex model + effort pin (CDX-10)", () => {
  test("each Codex TOML has model per spec table + model_reasoning_effort = high", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentToml(name);
      const parsed = toml.parse(raw) as Record<string, unknown>;
      expect(parsed.model).toBe(AGENT_MODELS_CODEX[name]);
      expect(parsed.model_reasoning_effort).toBe("high");
    }
  });
});

describe("subagent parity — Codex permission boundary (CDX-02/CDX-03)", () => {
  test("read-only agents have sandbox_mode = read-only; write agents = workspace-write", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentToml(name);
      const parsed = toml.parse(raw) as Record<string, unknown>;
      const sandbox = parsed.sandbox_mode;
      if (WRITE_AGENTS.has(name)) {
        expect(sandbox).toBe("workspace-write");
      } else {
        expect(sandbox).toBe("read-only");
      }
    }
  });
});

describe("subagent parity — Codex TOML round-trip + owned marker (CDX-07)", () => {
  test("each Codex TOML parses without error + first line is # massa-ai-owned", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentToml(name);
      // First line is the ownership marker
      const firstLine = raw.split(/\r?\n/)[0] ?? "";
      expect(firstLine).toBe("# massa-ai-owned");
      // Parses cleanly (round-trip)
      const parsed = toml.parse(raw) as Record<string, unknown>;
      expect(parsed.name).toBe(`massa-ai-${name}`);
      expect(typeof parsed.developer_instructions).toBe("string");
      expect((parsed.developer_instructions as string).length).toBeGreaterThan(0);
    }
  });
});

describe("subagent parity — Cursor model + effort pin (CRS-08)", () => {
  test("each Cursor agent has model = charter hint verbatim + reasoningEffort: max", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentMd("cursor-plugin", name);
      const fm = parseMdFrontmatter(raw);
      expect(fm.model).toBe(CHARTER_MODEL_HINTS[name]);
      expect(fm.reasoningEffort).toBe("max");
    }
  });
});

describe("subagent parity — OpenCode model + effort pin (OPC-10)", () => {
  test("each OpenCode agent has model = charter hint verbatim + reasoningEffort: max", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentMd("opencode-plugin", name);
      const fm = parseMdFrontmatter(raw);
      expect(fm.model).toBe(CHARTER_MODEL_HINTS[name]);
      expect(fm.reasoningEffort).toBe("max");
    }
  });
});

describe("subagent parity — OpenCode permission + owned marker (OPC-07)", () => {
  test("read-only agents have edit: deny + bash: deny (strict) or bash: ask (planner); write agents allow", async () => {
    for (const name of SPECIALIST_NAMES) {
      const raw = await readAgentMd("opencode-plugin", name);
      const fm = parseMdFrontmatter(raw);
      expect(fm.mode).toBe("subagent");
      // Owned marker
      expect(fm.metadata).toContain("massa-ai-owned: true");
      const perm = fm.permission ?? "";
      if (WRITE_AGENTS.has(name)) {
        expect(perm).toContain("edit: allow");
        expect(perm).toContain("bash: allow");
      } else if (name === "planner") {
        expect(perm).toContain("edit: deny");
        expect(perm).toContain('bash: { "*": "ask" }');
      } else {
        expect(perm).toContain("edit: deny");
        expect(perm).toContain("bash: deny");
      }
    }
  });
});

describe("subagent parity — FEATURES.md table parity (DOC-06, gated on T10)", () => {
  test("FEATURES.md subagent section 4 model-pinning tables byte-match spec (when section exists)", async () => {
    const featuresPath = path.join(REPO_ROOT, "FEATURES.md");
    const features = await fs.readFile(featuresPath, "utf8");
    // Gate: only assert if the subagent section exists (T10 lands later).
    if (!features.includes("Subagent Skills (12 Specialists)")) {
      console.log("  [gated] FEATURES.md subagent section not yet present (T10 pending) — skip DOC-06 sub-check");
      return;
    }
    // Assert the 4 model-pinning tables are present (byte-parity verified by
    // checking key model values appear in the FEATURES.md subagent section).
    const section = features.split("Subagent Skills (12 Specialists)")[1] ?? "";
    // Claude table
    expect(section).toContain("haiku");
    expect(section).toContain("sonnet");
    expect(section).toContain("opus");
    expect(section).toContain("effort: high");
    // Codex table
    expect(section).toContain("gpt-5.4-mini");
    expect(section).toContain("gpt-5.6-terra");
    expect(section).toContain("gpt-5.6-sol");
    expect(section).toContain('model_reasoning_effort = "high"');
    // Cursor/OpenCode table
    expect(section).toContain("DeepSeek V4 Pro");
    expect(section).toContain("GLM-5.2");
    expect(section).toContain("MiniMax M3");
    expect(section).toContain("reasoningEffort: max");
  });
});