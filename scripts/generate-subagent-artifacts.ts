#!/usr/bin/env bun
/**
 * massa-th0th subagent-artifacts generator (single source of truth).
 *
 * Reads the 12 specialist charters under skills/ and emits per-host agent
 * files into apps/{claude,codex,cursor,opencode}-plugin/agents/. Outputs are
 * checked into git so the plugins ship without a runtime build step.
 *
 *   bun run scripts/generate-subagent-artifacts.ts        # emit 48 files (12 x 4 hosts)
 *   bun run scripts/generate-subagent-artifacts.ts --check # drift gate: diff vs checked-in
 *
 * Model + effort + permission are PINNED per host (spec, NOT advisory). A parity
 * test (T4) re-runs --check so charter-to-shipped drift fails CI.
 */

import { promises as fs } from "fs";
import path from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

// ── Paths ───────────────────────────────────────────────────────────────────
const ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const APPS_DIR = path.join(ROOT, "apps");

const HOST_DIRS: Record<Host, string> = {
  claude: path.join(APPS_DIR, "claude-plugin", "agents"),
  codex: path.join(APPS_DIR, "codex-plugin", "agents"),
  cursor: path.join(APPS_DIR, "cursor-plugin", "agents"),
  opencode: path.join(APPS_DIR, "opencode-plugin", "agents"),
};

// ── Charter registry (the 12 specialists; excludes massa-th0th-memory/synapse-usage) ─
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

// ── Write-permission override (spec AC CLA-03 / design.md) ──────────────────
// Charters mark test-engineer + documentation-agent as read-only, but the spec
// grants them Write/Edit for the test/doc files in their disjoint write set.
const WRITE_AGENTS: ReadonlySet<SpecialistName> = new Set<SpecialistName>([
  "builder",
  "test-engineer",
  "documentation-agent",
]);

// ── Model-pinning tables (spec, PINNED, NOT advisory) ───────────────────────
// Claude aliases + effort: high (spec Claude table)
const AGENT_MODELS_CLAUDE: Record<SpecialistName, "haiku" | "sonnet" | "opus"> = {
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

// Codex IDs + model_reasoning_effort = "high" (spec Codex table)
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

// Cursor + OpenCode use charter metadata.model_hint verbatim + reasoningEffort: max.
// (Resolved at parse time from each charter's frontmatter.)

// ── Permission -> tools mapping (spec permission mapping) ───────────────────
// Navigator precedent (apps/claude-plugin/agents/massa-th0th-navigator.md) uses
// JSON-array tools with capital "Glob"; match that convention for all Claude/Cursor agents.
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const WRITE_TOOLS = [...READ_ONLY_TOOLS, "Write", "Edit"];

// OpenCode bash permission (spec OPC-07 / design.md plan-critic F4)
const OPENCODE_STRICT_READONLY: ReadonlySet<SpecialistName> = new Set<
  SpecialistName
>([
  "investigator",
  "context-curator",
  "verification-agent",
  "requirements-analyst",
  "architecture-specialist",
  "reviewer",
  "audit-specialist",
  "mobile-specialist",
]);
// planner is inspection-capable -> bash: { "*": "ask" }
// write agents -> bash: allow

// ── Host built-in names (spec name-collision ACs) ───────────────────────────
const HOST_BUILTINS: Record<Host, ReadonlySet<string>> = {
  claude: new Set(["Explore", "Plan", "general-purpose"]),
  codex: new Set(["default", "worker", "explorer"]),
  cursor: new Set(["Explore", "Plan", "general-purpose"]),
  opencode: new Set(["build", "plan", "general", "explore", "scout"]),
};

// ── Types ───────────────────────────────────────────────────────────────────
type Host = "claude" | "codex" | "cursor" | "opencode";
type Permission = "read-only" | "write";

interface Charter {
  name: SpecialistName;
  description: string;
  modelHint: string;
  permission: Permission;
  body: string;
}

// ── YAML frontmatter parser (minimal, charter-shaped) ───────────────────────
function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(
      "charter missing YAML frontmatter (--- ... ---) block"
    );
  }
  const yamlText = match[1] ?? "";
  const body = (match[2] ?? "").replace(/^\r?\n/, "");
  const frontmatter = parseSimpleYaml(yamlText);
  return { frontmatter, body };
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1] as string;
    const rest = (m[2] ?? "").trim();
    if (rest !== "") {
      result[key] = unquoteScalar(rest);
      i++;
      continue;
    }
    // Nested mapping (e.g. metadata: block). Only one level of nesting is
    // used by the charters (metadata.model_hint / metadata.permission).
    const nested: Record<string, unknown> = {};
    i++;
    while (i < lines.length) {
      const nestedLine = lines[i] ?? "";
      if (/^\s{2,}\S/.test(nestedLine) === false) break;
      const nm = /^\s{2,}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(nestedLine);
      if (!nm) break;
      nested[nm[1] as string] = unquoteScalar((nm[2] ?? "").trim());
      i++;
    }
    result[key] = nested;
  }
  return result;
}

function unquoteScalar(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

// ── Charter loader ──────────────────────────────────────────────────────────
async function loadCharter(name: SpecialistName): Promise<Charter> {
  const file = path.join(SKILLS_DIR, "agents", name, "SKILL.md");
  const raw = await fs.readFile(file, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const metadata = (frontmatter.metadata ?? {}) as Record<string, unknown>;
  const modelHint = String(metadata.model_hint ?? "");
  const permissionRaw = String(metadata.permission ?? "read-only");
  const permission: Permission =
    permissionRaw === "write" ? "write" : "read-only";
  const description = String(frontmatter.description ?? "");
  if (!description) {
    throw new Error(`charter ${name} missing description`);
  }
  if (!modelHint) {
    throw new Error(`charter ${name} missing metadata.model_hint`);
  }
  return { name, description, modelHint, permission, body };
}

async function loadAllCharters(): Promise<Charter[]> {
  const charters: Charter[] = [];
  for (const name of SPECIALIST_NAMES) {
    charters.push(await loadCharter(name));
  }
  return charters;
}

// ── Per-host emitters ───────────────────────────────────────────────────────

function emitClaude(c: Charter): string {
  const agentName = `massa-th0th-${c.name}`;
  const isWrite = WRITE_AGENTS.has(c.name);
  const tools = isWrite ? WRITE_TOOLS : READ_ONLY_TOOLS;
  const toolsJson = JSON.stringify(tools);
  const model = AGENT_MODELS_CLAUDE[c.name];
  // CLA-04: omit hooks/mcpServers/permissionMode (blocked on plugin-shipped agents)
  const fm = [
    "---",
    `name: ${agentName}`,
    `description: ${c.description}`,
    `tools: ${toolsJson}`,
    `model: ${model}`,
    `effort: high`,
    "---",
    "",
  ].join("\n");
  return fm + c.body + "\n";
}

function emitCursor(c: Charter): string {
  const agentName = `massa-th0th-${c.name}`;
  const isWrite = WRITE_AGENTS.has(c.name);
  const tools = isWrite ? WRITE_TOOLS : READ_ONLY_TOOLS;
  const toolsJson = JSON.stringify(tools);
  // CRS-08: model = charter hint verbatim; reasoningEffort: max (pass-through)
  const fm = [
    "---",
    `name: ${agentName}`,
    `description: ${c.description}`,
    `tools: ${toolsJson}`,
    `model: ${c.modelHint}`,
    `reasoningEffort: max`,
    "---",
    "",
  ].join("\n");
  return fm + c.body + "\n";
}

function escapeTomlTripleQuote(s: string): string {
  return s.replace(/"""/g, '\\"\\"\\"');
}

function emitCodex(c: Charter): string {
  const agentName = `massa-th0th-${c.name}`;
  const isWrite = WRITE_AGENTS.has(c.name);
  const sandboxMode = isWrite ? "workspace-write" : "read-only";
  const model = AGENT_MODELS_CODEX[c.name];
  const bodyEscaped = escapeTomlTripleQuote(c.body);
  // CDX-07: top comment `# massa-th0th-owned` for scoped uninstall
  const lines = [
    "# massa-th0th-owned",
    `name = "${agentName}"`,
    `description = ${tomlQuoted(c.description)}`,
    `model = "${model}"`,
    `model_reasoning_effort = "high"`,
    `sandbox_mode = "${sandboxMode}"`,
    `developer_instructions = """${bodyEscaped}"""`,
    "",
  ];
  return lines.join("\n");
}

function tomlQuoted(s: string): string {
  // Basic TOML string escaping.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function emitOpenCode(c: Charter): string {
  const agentName = `massa-th0th-${c.name}`;
  const isWrite = WRITE_AGENTS.has(c.name);
  // OPC-07: permission per-agent bash mapping
  let permissionBlock: string;
  if (isWrite) {
    permissionBlock = `{ edit: allow, bash: allow }`;
  } else if (c.name === "planner") {
    permissionBlock = `{ edit: deny, bash: { "*": "ask" } }`;
  } else {
    permissionBlock = `{ edit: deny, bash: deny }`;
  }
  // OPC-07: metadata ownership marker (hosts ignore unknown frontmatter)
  const fm = [
    "---",
    `name: ${agentName}`,
    `description: ${c.description}`,
    `mode: subagent`,
    `model: ${c.modelHint}`,
    `reasoningEffort: max`,
    `permission: ${permissionBlock}`,
    `metadata: { massa-th0th-owned: true }`,
    "---",
    "",
  ].join("\n");
  return fm + c.body + "\n";
}

// ── Emit-all + check ────────────────────────────────────────────────────────
async function emitAll(targetDirs: Record<Host, string>): Promise<void> {
  const charters = await loadAllCharters();
  for (const [host, dir] of Object.entries(targetDirs) as [Host, string][]) {
    await fs.mkdir(dir, { recursive: true });
    for (const c of charters) {
      const ext = host === "codex" ? "toml" : "md";
      const fileName = `massa-th0th-${c.name}.${ext}`;
      const filePath = path.join(dir, fileName);
      const content =
        host === "claude"
          ? emitClaude(c)
          : host === "codex"
            ? emitCodex(c)
            : host === "cursor"
              ? emitCursor(c)
              : emitOpenCode(c);
      await fs.writeFile(filePath, content, "utf8");
    }
  }
}

async function diffHost(
  generatedDir: string,
  checkedInDir: string,
  host: Host
): Promise<string[]> {
  // Compare ONLY the 12 generated specialist files per host. The navigator
  // (Claude/Cursor) and any non-massa-th0th files are not generator-owned and
  // are excluded from the drift check (spec: navigator preserved as-is).
  const ext = host === "codex" ? "toml" : "md";
  const expected = SPECIALIST_NAMES.map(
    (n) => `massa-th0th-${n}.${ext}`
  );
  const diffs: string[] = [];
  for (const rel of expected) {
    const gp = path.join(generatedDir, rel);
    const cp = path.join(checkedInDir, rel);
    const [gbuf, cbuf] = await Promise.all([
      fs.readFile(gp).catch(() => null),
      fs.readFile(cp).catch(() => null),
    ]);
    if (gbuf === null && cbuf !== null) {
      diffs.push(`+ ${rel} (missing in generated)`);
    } else if (gbuf !== null && cbuf === null) {
      diffs.push(`- ${rel} (missing in checked-in)`);
    } else if (gbuf !== null && cbuf !== null) {
      if (!gbuf.equals(cbuf)) {
        diffs.push(`M ${rel}`);
      }
    }
  }
  return diffs;
}

async function runCheck(): Promise<number> {
  // Emit to a temp dir, diff against checked-in dirs.
  const tmp = await fs.mkdtemp(path.join(tmpdir(), "massa-th0th-gen-"));
  try {
    const tmpDirs: Record<Host, string> = {
      claude: path.join(tmp, "claude"),
      codex: path.join(tmp, "codex"),
      cursor: path.join(tmp, "cursor"),
      opencode: path.join(tmp, "opencode"),
    };
    await emitAll(tmpDirs);
    let drift = false;
    for (const host of Object.keys(HOST_DIRS) as Host[]) {
      const diffs = await diffHost(tmpDirs[host], HOST_DIRS[host], host);
      if (diffs.length > 0) {
        drift = true;
        console.error(
          `[${host}] drift detected (${diffs.length} file(s) differ):`
        );
        for (const d of diffs) {
          console.error(`  ${d}`);
        }
      }
    }
    if (drift) {
      console.error(
        "\nDrift detected. Re-run `bun run scripts/generate-subagent-artifacts.ts` and commit the output."
      );
      return 1;
    }
    console.log("No drift: generated files match checked-in files.");
    return 0;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  if (check) {
    return runCheck();
  }
  await emitAll(HOST_DIRS);
  const total = SPECIALIST_NAMES.length * 4;
  console.log(`Emitted ${total} agent files (12 x 4 hosts).`);
  return 0;
}

const code = await main();
if (code !== 0) {
  process.exit(code);
}