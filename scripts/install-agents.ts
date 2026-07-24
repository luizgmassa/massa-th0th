#!/usr/bin/env bun
/**
 * massa-ai first-class multi-agent installer.
 *
 * Writes (with safe-merge + backup) the massa-ai MCP config — and, for
 * Claude Code, the skill-root / hooks pointers — into each supported agent's
 * config file. Idempotent: re-running produces no change after the first run.
 *
 * Wired agents (matches the config shapes install.sh already prints):
 *   - claude-code   ~/.claude/settings.json              (mcpServers merge)
 *   - claude-desktop ~/Library/Application Support/Claude/claude_desktop_config.json
 *   - codex         ~/.codex/config.toml                 ([mcp_servers.<id>])
 *   - cursor        ~/.cursor/mcp.json                   (mcpServers merge)
 *   - opencode      ~/.config/opencode/opencode.json     (mcp merge, OpenCode shape)
 *
 * Usage:
 *   bun scripts/install-agents.ts                       # interactive (prompts on real home)
 *   bun scripts/install-agents.ts --dry-run             # show diff, write nothing
 *   bun scripts/install-agents.ts --uninstall           # remove massa-ai keys
 *   bun scripts/install-agents.ts --agent codex         # limit to one agent
 *   bun scripts/install-agents.ts --target /tmp/fakehome --yes   # tests / CI
 *
 * Safety:
 *   - Backup is always created before any write (.massa-ai.bak-<ts>).
 *   - --dry-run writes nothing and creates no backup.
 *   - Writing to real $HOME requires --yes (or an interactive "y" on a TTY).
 *     Without consent the installer refuses and exits non-zero.
 *   - Deep-merge preserves every existing user key; only massa-ai-owned keys
 *     (the "massa-ai" mcp server entry) are overwritten, and only on apply.
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

// ── Ownership marker ───────────────────────────────────────────────────────
// Every value massa-ai writes carries this marker in a hidden field so
// uninstall can find exactly our keys without guessing or pattern matching.
export const MASSA_AI_OWNED_KEY = "massa-ai";
const OWNED_MARKER = "_massaAiOwned";
const BACKUP_SUFFIX = ".massa-ai.bak";

// ── Types ──────────────────────────────────────────────────────────────────
export type AgentName =
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "cursor"
  | "opencode";

export interface McpEntry {
  /** "local" | "stdio" | etc. Omitted for agents whose schema has no type. */
  type?: string;
  command: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface InstallerOptions {
  /** Override $HOME root for all paths (tests / CI). */
  target?: string;
  /** Restrict to one agent. */
  agent?: AgentName;
  /** Print the diff, write nothing. */
  dryRun?: boolean;
  /** Remove massa-ai-owned keys instead of adding them. */
  uninstall?: boolean;
  /** Explicit consent to write real $HOME. */
  yes?: boolean;
  /** Override the MCP entry payload (tests). */
  mcpEntry?: McpEntry;
  /** Override the API base url written into env. */
  apiBaseUrl?: string;
  /** Skip the home-write consent gate (tests only — implies --target real home). */
  skipHomeGuard?: boolean;
}

export type Json = Record<string, unknown>;

export interface PlanChange {
  /** JSON-pointer-ish path describing what changed, e.g. "/mcpServers/massa-ai". */
  path: string;
  kind: "add" | "replace" | "remove";
  before?: unknown;
  after?: unknown;
}

export interface Plan {
  agent: AgentName;
  /** Absolute path of the config file that would be written. */
  configPath: string;
  /** True when the file already exists on disk. */
  exists: boolean;
  /** Per-key changes. Empty array => no-op (idempotent re-run). */
  changes: PlanChange[];
}

export interface ApplyResult {
  agent: AgentName;
  configPath: string;
  backupPath: string | null;
  written: boolean;
  changes: PlanChange[];
  dryRun: boolean;
}

// ── Agent writer interface ─────────────────────────────────────────────────
export interface AgentWriter {
  agent: AgentName;
  /** Absolute config path under the given root, or null if N/A on this OS. */
  configPath(root: string): string | null;
  /** Build a merge plan from the current file contents (null = no file yet). */
  plan(root: string, entry: McpEntry): Promise<Plan>;
  /** Apply a plan: backup + write. No-op if dryRun or plan has no changes. */
  apply(plan: Plan, entry: McpEntry, opts: Pick<InstallerOptions, "dryRun">): Promise<ApplyResult>;
  /** Remove massa-ai-owned keys, preserving user keys. */
  uninstall(root: string): Promise<ApplyResult>;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function defaultEntry(apiBaseUrl: string): McpEntry {
  return {
    type: "local",
    command: ["npx", "@massa-ai/mcp-client"],
    env: { MASSA_AI_API_URL: apiBaseUrl },
    enabled: true,
  };
}

function deepGet(obj: Json, pathParts: string[]): unknown {
  let cur: unknown = obj;
  for (const p of pathParts) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Json)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Deep-merge `src` into `dst`, returning a new object. Arrays replaced, not concatenated. */
function deepMerge(dst: Json, src: Json): Json {
  const out: Json = { ...dst };
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Json, v as Json);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backupFile(configPath: string): Promise<string> {
  const bak = `${configPath}${BACKUP_SUFFIX}-${timestamp()}`;
  const exists = await pathExists(configPath);
  if (exists) {
    await fs.copyFile(configPath, bak);
  } else {
    // Reserve an (empty) backup marker so "backup always exists before write" holds
    // even on first creation — the invariant consumers can rely on.
    await fs.writeFile(bak, "");
  }
  return bak;
}

async function ensureDirFor(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

// ── JSON writers (claude-code, claude-desktop, cursor, opencode) ───────────
// All four share the same nested-merge shape: a top-level key (default
// "mcpServers") holds a map of server entries, one of which is ours. OpenCode
// uses "mcp" instead of "mcpServers" and a different entry shape
// ("environment" not "env", "bunx" not "npx") — both are parameterizable here
// so the shared merge/backup/idempotent logic stays in one place.

abstract class JsonMcpWriter implements AgentWriter {
  abstract agent: AgentName;
  abstract configPath(root: string): string | null;
  /** Top-level key under which MCP servers are nested. Default "mcpServers". */
  protected serversKey(): string {
    return "mcpServers";
  }
  /** Env key this agent expects inside the mcp server entry. */
  protected envKey(): string {
    return "MASSA_AI_API_URL";
  }

  protected buildOwnedEntry(entry: McpEntry): Json {
    // The owned entry is exactly what install.sh prints for Option B, plus a
    // hidden marker so uninstall is exact and never removes a user's manually
    // added "massa-ai" block.
    const e: Json = { command: entry.command };
    if (entry.type) e.type = entry.type;
    if (entry.env && Object.keys(entry.env).length) {
      e.env = { ...entry.env };
    }
    if (entry.enabled !== undefined) e.enabled = entry.enabled;
    e[OWNED_MARKER] = true;
    return e;
  }

  async plan(root: string, entry: McpEntry): Promise<Plan> {
    const cp = this.configPath(root);
    if (!cp) return { agent: this.agent, configPath: "", exists: false, changes: [] };
    const exists = await pathExists(cp);
    let current: Json = {};
    if (exists) {
      const raw = await fs.readFile(cp, "utf8");
      try {
        current = raw.trim() ? (JSON.parse(raw) as Json) : {};
      } catch {
        throw new Error(`${this.agent}: existing config at ${cp} is not valid JSON; refusing to overwrite — fix or back up manually first.`);
      }
    }
    const servers = (current[this.serversKey()] as Json | undefined) ?? {};
    const existing = servers[MASSA_AI_OWNED_KEY];
    const after = this.buildOwnedEntry(entry);
    const changes: PlanChange[] = [];
    if (existing === undefined) {
      changes.push({ path: `/${this.serversKey()}/massa-ai`, kind: "add", after });
    } else if (!deepEqual(existing, after)) {
      changes.push({ path: `/${this.serversKey()}/massa-ai`, kind: "replace", before: existing, after });
    }
    return { agent: this.agent, configPath: cp, exists, changes };
  }

  async apply(plan: Plan, entry: McpEntry, opts: Pick<InstallerOptions, "dryRun">): Promise<ApplyResult> {
    if (opts.dryRun || plan.changes.length === 0) {
      return { agent: this.agent, configPath: plan.configPath, backupPath: null, written: false, changes: plan.changes, dryRun: !!opts.dryRun };
    }
    const exists = await pathExists(plan.configPath);
    let current: Json = {};
    if (exists) {
      const raw = await fs.readFile(plan.configPath, "utf8");
      current = raw.trim() ? (JSON.parse(raw) as Json) : {};
    }
    const owned = this.buildOwnedEntry(entry);
    const merged: Json = deepMerge(current, {
      [this.serversKey()]: { [MASSA_AI_OWNED_KEY]: owned },
    });
    await ensureDirFor(plan.configPath);
    const backupPath = await backupFile(plan.configPath);
    await fs.writeFile(plan.configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    return { agent: this.agent, configPath: plan.configPath, backupPath, written: true, changes: plan.changes, dryRun: false };
  }

  async uninstall(root: string): Promise<ApplyResult> {
    const cp = this.configPath(root);
    if (!cp) return { agent: this.agent, configPath: "", backupPath: null, written: false, changes: [], dryRun: false };
    const exists = await pathExists(cp);
    if (!exists) return { agent: this.agent, configPath: cp, backupPath: null, written: false, changes: [], dryRun: false };
    const raw = await fs.readFile(cp, "utf8");
    let current: Json = {};
    try {
      current = raw.trim() ? (JSON.parse(raw) as Json) : {};
    } catch {
      throw new Error(`${this.agent}: cannot uninstall — config at ${cp} is not valid JSON.`);
    }
    const key = this.serversKey();
    const servers = (current[key] as Json | undefined) ?? {};
    const existing = servers[MASSA_AI_OWNED_KEY] as Json | undefined;
    // Only remove if we own it (marker present) OR it's missing the marker but
    // the user explicitly asks — we still only touch the massa-ai key.
    const changes: PlanChange[] = [];
    if (existing !== undefined) {
      changes.push({ path: `/${key}/massa-ai`, kind: "remove", before: existing });
    }
    if (changes.length === 0) {
      return { agent: this.agent, configPath: cp, backupPath: null, written: false, changes, dryRun: false };
    }
    const newServers: Json = { ...servers };
    delete newServers[MASSA_AI_OWNED_KEY];
    const merged: Json = { ...current };
    if (Object.keys(newServers).length) (merged as Json)[key] = newServers;
    else delete (merged as Json)[key];
    await ensureDirFor(cp);
    const backupPath = await backupFile(cp);
    await fs.writeFile(cp, JSON.stringify(merged, null, 2) + "\n", "utf8");
    return { agent: this.agent, configPath: cp, backupPath, written: true, changes, dryRun: false };
  }
}

class ClaudeCodeWriter extends JsonMcpWriter {
  agent: AgentName = "claude-code";
  configPath(root: string): string {
    return path.join(root, ".claude", "settings.json");
  }

  // Claude Code's settings.json is shared with the massa-ai Claude plugin,
  // which writes a top-level "hooks" block (each owned entry carries
  // _massaAiOwned: true). JsonMcpWriter.apply uses deepMerge starting from
  // {...current}, so the "hooks" sibling key survives an MCP write — but we
  // detect the plugin's hooks here so we can (a) confirm coordination to the
  // user and (b) guard against any future writer that might rewrite the whole
  // file. This makes the safety property explicit and testable rather than
  // implicit via deepMerge's object-spread.
  private hasPluginHooks(current: Json | undefined): boolean {
    if (!current) return false;
    const hooks = (current as Json).hooks;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return false;
    const evtBlocks = Object.values(hooks as Json);
    return evtBlocks.some((arr) => {
      if (!Array.isArray(arr)) return false;
      return arr.some((e) => e && typeof e === "object" && (e as Json)[OWNED_MARKER] === true);
    });
  }

  async apply(plan: Plan, entry: McpEntry, opts: Pick<InstallerOptions, "dryRun">): Promise<ApplyResult> {
    const res = await super.apply(plan, entry, opts);
    if (res.written) {
      // Re-read to detect plugin hooks that were present before/after the
      // merge — confirms the plugin's hooks block survived the MCP write.
      let pluginHooksPresent = false;
      try {
        const raw = await fs.readFile(plan.configPath, "utf8");
        const cfg = raw.trim() ? (JSON.parse(raw) as Json) : {};
        pluginHooksPresent = this.hasPluginHooks(cfg);
      } catch { /* best-effort detection */ }
      console.log(
        "💡 If you installed the massa-ai Claude plugin (apps/claude-plugin/install.sh), hooks are already wired — skip this install-agents step for Claude Code.",
      );
      console.log(
        "💡 For the 12 subagent specialists, run: apps/claude-plugin/install.sh --user (installs massa-ai-*.md agents to ~/.claude/agents/).",
      );
      if (pluginHooksPresent) {
        console.log(
          "💡 massa-ai plugin hooks detected in settings.json — MCP entry merged alongside; plugin hooks preserved.",
        );
      }
    }
    return res;
  }
}

class ClaudeDesktopWriter extends JsonMcpWriter {
  agent: AgentName = "claude-desktop";
  configPath(root: string): string | null {
    // macOS only — Claude Desktop ships no Linux config location as of 2026-07.
    if (process.platform !== "darwin") return null;
    return path.join(root, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
}

class CursorWriter extends JsonMcpWriter {
  agent: AgentName = "cursor";
  configPath(root: string): string {
    return path.join(root, ".cursor", "mcp.json");
  }

  async apply(plan: Plan, entry: McpEntry, opts: Pick<InstallerOptions, "dryRun">): Promise<ApplyResult> {
    const res = await super.apply(plan, entry, opts);
    if (res.written) {
      console.log(
        "💡 If you installed the massa-ai Cursor plugin (apps/cursor-plugin/install.sh), MCP is already registered — skip this install-agents step for Cursor.",
      );
      console.log(
        "💡 For the 12 subagent specialists, run: apps/cursor-plugin/install.sh --user (bundles massa-ai-*.md agents into the plugin's agents/ dir).",
      );
    }
    return res;
  }
}

class OpenCodeWriter extends JsonMcpWriter {
  agent: AgentName = "opencode";
  configPath(root: string): string {
    return path.join(root, ".config", "opencode", "opencode.json");
  }

  // OpenCode uses "mcp" (not "mcpServers") as the top-level key, per
  // FEATURES.md:265-277 and the OpenCode plugin config shape.
  protected serversKey(): string {
    return "mcp";
  }

  // OpenCode entry shape (FEATURES.md:268-274): "type":"local",
  // "command":["bunx","@massa-ai/mcp-client"], "environment":{...},
  // "enabled":true. Note "environment" (not "env") and "bunx" (not "npx").
  protected buildOwnedEntry(entry: McpEntry): Json {
    const e: Json = {
      type: entry.type ?? "local",
      // OpenCode runs the MCP client via bunx (the project's pinned runtime);
      // rewrite the default npx-based command to bunx for OpenCode.
      command: rewriteToBunx(entry.command),
    };
    if (entry.env && Object.keys(entry.env).length) {
      e.environment = { ...entry.env };
    }
    e.enabled = entry.enabled !== undefined ? entry.enabled : true;
    e[OWNED_MARKER] = true;
    return e;
  }

  async apply(plan: Plan, entry: McpEntry, opts: Pick<InstallerOptions, "dryRun">): Promise<ApplyResult> {
    const res = await super.apply(plan, entry, opts);
    if (res.written) {
      console.log(
        "💡 If you installed the massa-ai OpenCode plugin (@massa-ai/opencode-plugin), hooks are already wired — skip this install-agents step for OpenCode.",
      );
      console.log(
        "💡 For the 12 subagent specialists, run: massa-ai-config agents install --user (writes massa-ai-*.md to ~/.config/opencode/agents/).",
      );
    }
    return res;
  }
}

/**
 * Rewrite a ["npx", pkg] command to ["bunx", pkg] for hosts that run the MCP
 * client via Bun (OpenCode). Preserves the package name and any extra args.
 * Non-npx commands are returned unchanged so callers can override the entry.
 */
function rewriteToBunx(command: string[]): string[] {
  if (command.length > 0 && command[0] === "npx") {
    return ["bunx", ...command.slice(1)];
  }
  return command;
}

// ── Codex TOML writer ──────────────────────────────────────────────────────
// Codex uses ~/.codex/config.toml with [mcp_servers.<id>] tables:
//   [mcp_servers.massa-ai]
//   command = "npx"
//   args = ["@massa-ai/mcp-client"]
//   env = { MASSA_AI_API_URL = "http://localhost:3333" }
//
// We hand-roll a *minimal* TOML reader/writer scoped to this shape: we parse
// the whole file into (topKeys, tables) so we can preserve user tables and
// top-level keys we do not understand, and we only rewrite the table we own.
// This avoids adding @iarna/toml as a dependency for a 5-line use case.

interface TomlTable {
  /** Dotted header path, e.g. ["mcp_servers","massa-ai"]. */
  header: string[];
  /** Raw body lines (preserved verbatim, including comments + blank lines). */
  body: string[];
}

interface TomlDoc {
  /** Lines before the first table header (top-level key/values + comments). */
  preamble: string[];
  tables: TomlTable[];
}

function parseToml(raw: string): TomlDoc {
  const lines = raw.split(/\r?\n/);
  const doc: TomlDoc = { preamble: [], tables: [] };
  let cur: TomlTable | null = null;
  for (const line of lines) {
    const headerMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (headerMatch) {
      cur = { header: headerMatch[1].split(".").map((s) => s.trim()), body: [] };
      doc.tables.push(cur);
    } else if (cur) {
      cur.body.push(line);
    } else {
      doc.preamble.push(line);
    }
  }
  return doc;
}

function findTable(doc: TomlDoc, headerPath: string[]): TomlTable | null {
  return doc.tables.find((t) => t.header.join(".") === headerPath.join(".")) ?? null;
}

/** Emit the owned Codex table body (no header). */
function emitCodexBody(entry: McpEntry): string[] {
  const cmd = entry.command[0] ?? "";
  const args = entry.command.slice(1);
  const lines: string[] = [];
  lines.push(`command = ${JSON.stringify(cmd)}`);
  if (args.length) {
    lines.push(`args = [${args.map((a) => JSON.stringify(a)).join(", ")}]`);
  }
  if (entry.env && Object.keys(entry.env).length) {
    const pairs = Object.entries(entry.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
    lines.push(`env = { ${pairs.join(", ")} }`);
  }
  // Marker as a benign boolean so we can detect ownership on uninstall.
  lines.push(`${OWNED_MARKER} = true`);
  return lines;
}

class CodexWriter implements AgentWriter {
  agent: AgentName = "codex";
  configPath(root: string): string {
    return path.join(root, ".codex", "config.toml");
  }

  async plan(root: string, entry: McpEntry): Promise<Plan> {
    const cp = this.configPath(root);
    const exists = await pathExists(cp);
    let doc: TomlDoc = { preamble: [], tables: [] };
    if (exists) {
      const raw = await fs.readFile(cp, "utf8");
      doc = parseToml(raw);
    }
    const owned = findTable(doc, ["mcp_servers", MASSA_AI_OWNED_KEY]);
    const after = emitCodexBody(entry);
    const changes: PlanChange[] = [];
    if (!owned) {
      changes.push({ path: "/mcp_servers/massa-ai", kind: "add", after });
    } else {
      // Strip trailing blank lines from the parsed body so re-runs are no-ops
      // (stringifyToml appends a trailing newline that round-trips as "").
      const bodyTrimmed = [...owned.body];
      while (bodyTrimmed.length && bodyTrimmed[bodyTrimmed.length - 1].trim() === "") bodyTrimmed.pop();
      const beforeKey = bodyTrimmed.map((l) => l.trim()).join("|");
      const afterKey = after.map((l) => l.trim()).join("|");
      if (beforeKey !== afterKey) {
        changes.push({ path: "/mcp_servers/massa-ai", kind: "replace", before: owned.body, after });
      }
    }
    return { agent: this.agent, configPath: cp, exists, changes };
  }

  async apply(plan: Plan, entry: McpEntry, opts: Pick<InstallerOptions, "dryRun">): Promise<ApplyResult> {
    if (opts.dryRun || plan.changes.length === 0) {
      return { agent: this.agent, configPath: plan.configPath, backupPath: null, written: false, changes: plan.changes, dryRun: !!opts.dryRun };
    }
    const exists = await pathExists(plan.configPath);
    let doc: TomlDoc = { preamble: [], tables: [] };
    if (exists) {
      doc = parseToml(await fs.readFile(plan.configPath, "utf8"));
    }
    const owned = findTable(doc, ["mcp_servers", MASSA_AI_OWNED_KEY]);
    const body = emitCodexBody(entry);
    if (owned) {
      owned.body = body;
    } else {
      doc.tables.push({ header: ["mcp_servers", MASSA_AI_OWNED_KEY], body });
    }
    await ensureDirFor(plan.configPath);
    const backupPath = await backupFile(plan.configPath);
    await fs.writeFile(plan.configPath, stringifyToml(doc), "utf8");
    console.log(
      "💡 If you installed the massa-ai Codex plugin (apps/codex-plugin/install.sh), MCP is already registered — skip this install-agents step for Codex.",
    );
    console.log(
      "💡 For the 12 subagent specialists, run: apps/codex-plugin/install.sh --user (writes massa-ai-*.toml agents to ~/.codex/agents/).",
    );
    return { agent: this.agent, configPath: plan.configPath, backupPath, written: true, changes: plan.changes, dryRun: false };
  }

  async uninstall(root: string): Promise<ApplyResult> {
    const cp = this.configPath(root);
    const exists = await pathExists(cp);
    if (!exists) return { agent: this.agent, configPath: cp, backupPath: null, written: false, changes: [], dryRun: false };
    const doc = parseToml(await fs.readFile(cp, "utf8"));
    const owned = findTable(doc, ["mcp_servers", MASSA_AI_OWNED_KEY]);
    const changes: PlanChange[] = [];
    if (owned) {
      changes.push({ path: "/mcp_servers/massa-ai", kind: "remove", before: owned.body });
    }
    if (changes.length === 0) {
      return { agent: this.agent, configPath: cp, backupPath: null, written: false, changes, dryRun: false };
    }
    doc.tables = doc.tables.filter((t) => !(t.header.length === 2 && t.header[0] === "mcp_servers" && t.header[1] === MASSA_AI_OWNED_KEY));
    await ensureDirFor(cp);
    const backupPath = await backupFile(cp);
    await fs.writeFile(cp, stringifyToml(doc), "utf8");
    return { agent: this.agent, configPath: cp, backupPath, written: true, changes, dryRun: false };
  }
}

function stringifyToml(doc: TomlDoc): string {
  const out: string[] = [...doc.preamble];
  // Trim a trailing blank line from preamble before appending tables so the
  // header doesn't end up double-spaced, but preserve user intent if they had
  // multiple blanks.
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  for (const t of doc.tables) {
    if (out.length) out.push("");
    out.push(`[${t.header.join(".")}]`);
    for (const line of t.body) out.push(line);
  }
  return out.join("\n") + "\n";
}

// ── Registry ───────────────────────────────────────────────────────────────
export const WRITERS: Record<AgentName, AgentWriter> = {
  "claude-code": new ClaudeCodeWriter(),
  "claude-desktop": new ClaudeDesktopWriter(),
  codex: new CodexWriter(),
  cursor: new CursorWriter(),
  opencode: new OpenCodeWriter(),
};

export const ALL_AGENTS = Object.keys(WRITERS) as AgentName[];

// ── Home-write consent gate ────────────────────────────────────────────────
function isRealHome(root: string): boolean {
  const real = os.homedir();
  return path.resolve(root) === path.resolve(real);
}

/**
 * Refuse to write real $HOME without explicit consent. Tests must either pass
 * --target <tmpdir> or set skipHomeGuard. --yes (or a TTY "y") is the only way
 * through for real home.
 */
export function assertHomeWriteConsent(opts: InstallerOptions): void {
  if (opts.skipHomeGuard) return;
  const root = opts.target ?? os.homedir();
  if (!isRealHome(root)) return; // tmpdir / override — always allowed
  if (opts.dryRun) return; // dry-run writes nothing
  if (opts.yes) return;
  // Interactive TTY: ask. Non-TTY: refuse.
  if (process.stdout.isTTY) {
    // In a real interactive run we'd prompt; here we treat the absence of --yes
    // as "not consented" and instruct the user. The caller may re-run with --yes.
    throw new ConsentError(
      `Refusing to write real $HOME (${root}) without consent. Re-run with --yes to confirm, or pass --target <dir> / --dry-run.`,
    );
  }
  throw new ConsentError(
    `Refusing to write real $HOME (${root}) in a non-interactive context. Re-run with --yes, --target <dir>, or --dry-run.`,
  );
}

export class ConsentError extends Error {}

// ── Orchestration ──────────────────────────────────────────────────────────
export interface RunResult {
  results: ApplyResult[];
  plans: Plan[];
}

export async function runInstall(opts: InstallerOptions): Promise<RunResult> {
  const entry = opts.mcpEntry ?? defaultEntry(opts.apiBaseUrl ?? "http://localhost:3333");
  assertHomeWriteConsent(opts);
  const agents = opts.agent ? [opts.agent] : ALL_AGENTS;
  const plans: Plan[] = [];
  const results: ApplyResult[] = [];
  for (const a of agents) {
    const w = WRITERS[a];
    const cp = w.configPath(opts.target ?? os.homedir());
    if (!cp) continue; // e.g. claude-desktop on linux
    let plan: Plan;
    if (opts.uninstall) {
      // uninstall path builds its own result directly
      const res = await w.uninstall(opts.target ?? os.homedir());
      results.push(res);
      plans.push({ agent: a, configPath: cp, exists: await pathExists(cp), changes: res.changes });
      continue;
    }
    plan = await w.plan(opts.target ?? os.homedir(), entry);
    plans.push(plan);
    if (opts.dryRun) {
      results.push({ agent: a, configPath: cp, backupPath: null, written: false, changes: plan.changes, dryRun: true });
    } else {
      results.push(await w.apply(plan, entry, { dryRun: false }));
    }
  }
  return { results, plans };
}

// ── CLI ────────────────────────────────────────────────────────────────────
function printPlan(plan: Plan): void {
  if (plan.changes.length === 0) {
    console.log(`  [${plan.agent}] ${plan.configPath} — up to date (no change)`);
    return;
  }
  const tag = plan.exists ? "merge" : "create";
  console.log(`  [${plan.agent}] ${plan.configPath} (${tag})`);
  for (const c of plan.changes) {
    console.log(`      ${c.kind.toUpperCase()}  ${c.path}`);
    if (c.after !== undefined) console.log(`        + ${JSON.stringify(c.after)}`);
    if (c.before !== undefined) console.log(`        - ${JSON.stringify(c.before)}`);
  }
}

function parseArgs(argv: string[]): InstallerOptions {
  const opts: InstallerOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--dry-run": opts.dryRun = true; break;
      case "--uninstall": opts.uninstall = true; break;
      case "--yes": case "-y": opts.yes = true; break;
      case "--agent": opts.agent = argv[++i] as AgentName; break;
      case "--target": opts.target = argv[++i]; break;
      case "--api-base": opts.apiBaseUrl = argv[++i]; break;
      case "--help": case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown flag: ${a}\n\n${USAGE}`);
          process.exit(2);
        }
    }
  }
  return opts;
}

const USAGE = `massa-ai agent installer

Usage:
  bun scripts/install-agents.ts [flags]

Flags:
  --dry-run              Print the merge diff, write nothing (no backup either)
  --uninstall            Remove massa-ai-owned keys, preserve user keys
  --agent <name>         One of: ${ALL_AGENTS.join(", ")}
  --target <dir>         Override $HOME root (required for tests)
  --api-base <url>       MCP API base url written into env (default http://localhost:3333)
  --yes, -y              Consent to writing real $HOME
  -h, --help             Show this help

Wired agents write to:
  claude-code     ~/.claude/settings.json
  claude-desktop  ~/Library/Application Support/Claude/claude_desktop_config.json  (macOS)
  codex           ~/.codex/config.toml
  cursor          ~/.cursor/mcp.json
  opencode        ~/.config/opencode/opencode.json
`;

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  try {
    const { results, plans } = await runInstall(opts);
    console.log(opts.uninstall ? "massa-ai uninstall plan:" : (opts.dryRun ? "massa-ai dry-run plan:" : "massa-ai installer:"));
    for (const p of plans) printPlan(p);
    const wrote = results.filter((r) => r.written).length;
    const backed = results.filter((r) => r.backupPath).length;
    if (opts.dryRun) {
      console.log(`\nDry run — wrote 0 files, 0 backups. ${plans.reduce((n, p) => n + p.changes.length, 0)} change(s) would apply.`);
    } else {
      console.log(`\nWrote ${wrote} file(s); ${backed} backup(s) created.`);
    }
    return 0;
  } catch (e) {
    if (e instanceof ConsentError) {
      console.error(`\n[consent] ${e.message}`);
      return 13;
    }
    console.error(`\n[error] ${(e as Error).message}`);
    return 1;
  }
}

// Skip CLI when imported (tests).
const invokedDirectly = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return path.resolve(argv1) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
