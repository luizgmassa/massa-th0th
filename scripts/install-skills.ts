#!/usr/bin/env bun
/**
 * massa-th0th unified skills installer.
 *
 * Symlinks repo-local skills (skills dir, each with SKILL.md) into each
 * supported coding agent's config directory, and writes the bootstrap
 * contract block into the agent's AGENTS.md. Supports install (--apply),
 * uninstall, dry-run, and drift check (--check) across all four platforms:
 * Claude Code, Codex, Cursor, and OpenCode.
 *
 * Usage:
 *   bun scripts/install-skills.ts --apply --platform all           # install
 *   bun scripts/install-skills.ts --uninstall --platform all        # remove
 *   bun scripts/install-skills.ts --dry-run --platform all          # preview
 *   bun scripts/install-skills.ts --check --platform all            # drift check
 *   bun scripts/install-skills.ts --apply --platform claude         # one platform
 *   bun scripts/install-skills.ts --apply --target /tmp/fakehome --yes  # tests
 *
 * Safety:
 *   - Aborts on non-symlink conflict at a target path (won't overwrite user files).
 *   - --dry-run writes nothing.
 *   - State persisted to ~/.config/massa-th0th/install-state.json (v2 format).
 *   - v1 state (legacy) auto-migrated to v2.
 *   - Idempotent: re-running --apply is a no-op when symlinks are correct.
 */

import { promises as fs } from "fs";
import { execSync } from "child_process";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

// ── Constants ───────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const PLATFORMS = ["claude", "codex", "cursor", "opencode"] as const;
export type Platform = (typeof PLATFORMS)[number];

const PLATFORM_LABELS: Record<Platform | "shared", string> = {
  shared: "Shared",
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

const PLATFORM_EXECUTABLES: Record<Platform, string[]> = {
  claude: ["claude"],
  codex: ["codex"],
  cursor: ["cursor-agent", "cursor"],
  opencode: ["opencode"],
};

export const BOOTSTRAP_START = "<!-- massa-th0th:bootstrap:start -->";
export const BOOTSTRAP_END = "<!-- massa-th0th:bootstrap:end -->";

const STATE_RELATIVE_PATH = path.join(".config", "massa-th0th", "install-state.json");

// ── Types ──────────────────────────────────────────────────────────────────

export interface InstalledTool {
  platform: Platform;
  executable: string;
  path: string;
}

export interface OperationResult {
  platform: Platform;
  target: string;
  status: "ok" | "changed" | "would-change" | "drift" | "skipped" | "error";
  message: string;
}

export interface PlatformRecord {
  root: string;
  skills: string[];
}

export interface InstallerState {
  version: 2;
  repository: string | null;
  platforms: Record<string, PlatformRecord>;
}

export interface CliOptions {
  action: "apply" | "uninstall" | "dry-run" | "check";
  platforms: Platform[];
  target: string;
  repoRoot: string;
  yes: boolean;
  json: boolean;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

// ── Repo root resolution (F1 mitigation) ──────────────────────────────────

export function resolveRepoRoot(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  return REPO_ROOT;
}

// ── Skill discovery ────────────────────────────────────────────────────────

export async function discoverSkillSources(repoRoot: string): Promise<Map<string, string>> {
  const skillsRoot = path.join(repoRoot, "skills");
  const sources = new Map<string, string>();
  try {
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = path.join(skillsRoot, entry.name, "SKILL.md");
        try {
          await fs.access(skillMd);
          sources.set(entry.name, path.resolve(skillsRoot, entry.name));
        } catch {
          // no SKILL.md — skip
        }
      }
    }
  } catch {
    throw new IntegrationError(`Missing skills directory: ${skillsRoot}`);
  }
  if (sources.size === 0) {
    throw new IntegrationError(`No installable skills found in ${skillsRoot}`);
  }
  return sources;
}

// ── Bootstrap extraction ─────────────────────────────────────────────────

export function extractBootstrapBlock(text: string): string {
  const startCount = text.split(BOOTSTRAP_START).length - 1;
  const endCount = text.split(BOOTSTRAP_END).length - 1;
  if (startCount !== endCount || startCount > 1) {
    throw new IntegrationError("Managed markers are incomplete or duplicated");
  }
  if (startCount === 0) {
    throw new IntegrationError("Bootstrap block not found in skills/AGENTS.md");
  }
  const startIndex = text.indexOf(BOOTSTRAP_START);
  const endIndex = text.indexOf(BOOTSTRAP_END, startIndex) + BOOTSTRAP_END.length;
  return text.slice(startIndex, endIndex);
}

export async function extractBootstrap(repoRoot: string): Promise<string> {
  const agentsPath = path.join(repoRoot, "skills", "AGENTS.md");
  try {
    const text = await fs.readFile(agentsPath, "utf-8");
    return extractBootstrapBlock(text);
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(`Missing canonical agents file: ${agentsPath}`);
  }
}

// ── Platform detection ─────────────────────────────────────────────────────

export function detectInstalledTools(
  requested: Platform[],
  envPath?: string
): Map<Platform, InstalledTool> {
  const installed = new Map<Platform, InstalledTool>();
  for (const platform of requested) {
    for (const executable of PLATFORM_EXECUTABLES[platform]) {
      try {
        const result = execSync(`command -v ${executable} 2>/dev/null || true`, {
          encoding: "utf-8",
          env: { ...process.env, PATH: envPath ?? process.env.PATH ?? "" },
        }).trim();
        if (result) {
          installed.set(platform, {
            platform,
            executable,
            path: path.resolve(result),
          });
          break;
        }
      } catch {
        // continue
      }
    }
  }
  return installed;
}

// ── Platform root resolution ───────────────────────────────────────────────

export function resolveCodexHome(home: string, explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const primary = path.join(home, ".codex");
  const fallback = path.join(home, ".config", "codex");
  // Return primary if it exists, else fallback, else primary as default
  try {
    execSync(`test -d ${primary}`, { stdio: "ignore" });
    return path.resolve(primary);
  } catch {
    try {
      execSync(`test -d ${fallback}`, { stdio: "ignore" });
      return path.resolve(fallback);
    } catch {
      return path.resolve(primary);
    }
  }
}

export function platformRoot(home: string, codexHome: string, platform: Platform): string {
  switch (platform) {
    case "claude": return path.join(home, ".claude");
    case "codex": return codexHome;
    case "cursor": return path.join(home, ".cursor");
    case "opencode": return path.join(home, ".config", "opencode");
  }
}

// ── State management ──────────────────────────────────────────────────────

export function statePath(home: string): string {
  return path.join(home, STATE_RELATIVE_PATH);
}

export async function loadState(filePath: string, home: string, codexHome: string): Promise<InstallerState> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return { version: 2, repository: null, platforms: {} };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new IntegrationError(`Malformed JSON in installer state: ${filePath}`);
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new IntegrationError(`Expected a JSON object in ${filePath}`);
  }

  const obj = data as Record<string, unknown>;
  const version = obj.version ?? 1;

  // v1 migration: platforms was an array of platform names
  if (version === 1) {
    const platformsArr = obj.platforms;
    if (!Array.isArray(platformsArr)) {
      throw new IntegrationError(`Invalid platform list in installer state: ${filePath}`);
    }
    const records: Record<string, PlatformRecord> = {};
    for (const p of platformsArr) {
      if (typeof p !== "string" || !PLATFORMS.includes(p as Platform)) {
        throw new IntegrationError(`Invalid platform in installer state: ${filePath}`);
      }
      const root = platformRoot(home, codexHome, p as Platform);
      records[p] = { root, skills: [] };
    }
    return { version: 2, repository: typeof obj.repository === "string" ? obj.repository : null, platforms: records };
  }

  if (version !== 2) {
    throw new IntegrationError(`Unsupported installer state version in ${filePath}`);
  }

  const platformsData = obj.platforms;
  if (typeof platformsData !== "object" || platformsData === null || Array.isArray(platformsData)) {
    throw new IntegrationError(`Invalid platform records in installer state: ${filePath}`);
  }

  const records: Record<string, PlatformRecord> = {};
  for (const [platform, record] of Object.entries(platformsData as Record<string, unknown>)) {
    if (!PLATFORMS.includes(platform as Platform) || typeof record !== "object" || record === null) {
      throw new IntegrationError(`Invalid platform record in installer state: ${filePath}`);
    }
    const r = record as Record<string, unknown>;
    const root = r.root;
    if (typeof root !== "string" || !root) {
      throw new IntegrationError(`Invalid platform root in installer state: ${filePath}`);
    }
    const skills = r.skills;
    if (!Array.isArray(skills) || skills.some((s) => typeof s !== "string" || !s || s === "." || s === ".." || s.includes("/"))) {
      throw new IntegrationError(`Invalid skill list in installer state: ${filePath}`);
    }
    records[platform] = { root, skills: [...new Set(skills as string[])] };
  }

  return { version: 2, repository: typeof obj.repository === "string" ? obj.repository : null, platforms: records };
}

export async function saveState(filePath: string, state: InstallerState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

// ── Bootstrap block write/replace ─────────────────────────────────────────

function replaceBlock(text: string, desired: string): string {
  const startCount = text.split(BOOTSTRAP_START).length - 1;
  const endCount = text.split(BOOTSTRAP_END).length - 1;
  if (startCount !== endCount || startCount > 1) {
    throw new IntegrationError("Managed markers are incomplete or duplicated");
  }
  if (startCount === 1) {
    const startIndex = text.indexOf(BOOTSTRAP_START);
    const endIndex = text.indexOf(BOOTSTRAP_END, startIndex) + BOOTSTRAP_END.length;
    return text.slice(0, startIndex) + desired + text.slice(endIndex);
  }
  // No markers: append
  if (!text.trim()) return desired + "\n";
  return text.trimEnd() + "\n\n" + desired + "\n";
}

function removeBlock(text: string): string {
  const startCount = text.split(BOOTSTRAP_START).length - 1;
  const endCount = text.split(BOOTSTRAP_END).length - 1;
  if (startCount !== endCount || startCount > 1) {
    throw new IntegrationError("Managed markers are incomplete or duplicated");
  }
  if (startCount === 0) return text;
  const startIndex = text.indexOf(BOOTSTRAP_START);
  const endIndex = text.indexOf(BOOTSTRAP_END, startIndex) + BOOTSTRAP_END.length;
  const before = text.slice(0, startIndex);
  let after = text.slice(endIndex);
  if (before.endsWith("\n\n") && after.startsWith("\n")) {
    after = after.slice(1);
  }
  const result = (before + after).trim();
  return result ? result + "\n" : "";
}

// ── Symlink operations ─────────────────────────────────────────────────────

async function createSymlink(source: string, target: string, dryRun: boolean): Promise<OperationResult | null> {
  // Check if target already exists
  let existing: fs.Dirent | null = null;
  try {
    existing = await fs.lstat(target);
  } catch {
    // doesn't exist — fine
  }

  if (existing) {
    if (existing.isSymbolicLink()) {
      const currentTarget = await fs.readlink(target);
      const resolvedCurrent = path.resolve(path.dirname(target), currentTarget);
      if (resolvedCurrent === source) {
        return null; // already correct — idempotent
      }
      // Wrong target — will replace
      if (!dryRun) {
        await fs.unlink(target);
      }
    } else {
      // Not a symlink — abort (safety: MIG-06)
      return {
        platform: "claude", // will be overwritten by caller
        target,
        status: "error",
        message: `Conflict: ${target} exists as a regular file (not a symlink). Aborting to avoid overwriting user data.`,
      };
    }
  }

  if (dryRun) {
    return {
      platform: "claude", // will be overwritten
      target,
      status: "would-change",
      message: `Would symlink: ${target} -> ${source}`,
    };
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.symlink(source, target, "dir");
  return {
    platform: "claude", // will be overwritten
    target,
    status: "changed",
    message: `Symlinked: ${target} -> ${source}`,
  };
}

async function removeSymlink(target: string, expectedSource: string, dryRun: boolean): Promise<OperationResult | null> {
  let existing: fs.Dirent | null = null;
  try {
    existing = await fs.lstat(target);
  } catch {
    return null; // doesn't exist — nothing to remove
  }

  if (!existing.isSymbolicLink()) {
    return null; // not our symlink — skip
  }

  const currentTarget = await fs.readlink(target);
  const resolvedCurrent = path.resolve(path.dirname(target), currentTarget);
  if (resolvedCurrent !== expectedSource) {
    return null; // points elsewhere — not ours
  }

  if (dryRun) {
    return {
      platform: "claude",
      target,
      status: "would-change",
      message: `Would remove symlink: ${target}`,
    };
  }

  await fs.unlink(target);

  // Try to clean up empty parent dir (if we created it)
  const parentDir = path.dirname(target);
  try {
    const entries = await fs.readdir(parentDir);
    if (entries.length === 0) {
      await fs.rmdir(parentDir);
    }
  } catch {
    // ignore
  }

  return {
    platform: "claude",
    target,
    status: "changed",
    message: `Removed symlink: ${target}`,
  };
}

// ── Per-platform operations ────────────────────────────────────────────────

interface PlatformAction {
  platform: Platform;
  results: OperationResult[];
  state: PlatformRecord;
}

export async function applyPlatform(
  platform: Platform,
  home: string,
  codexHome: string,
  skills: Map<string, string>,
  bootstrap: string,
  dryRun: boolean,
): Promise<PlatformAction> {
  const root = platformRoot(home, codexHome, platform);
  const skillsDir = path.join(root, "skills");
  const agentsMdPath = path.join(root, "AGENTS.md");
  const results: OperationResult[] = [];
  const installedSkills: string[] = [];

  for (const [skillName, skillSource] of skills) {
    const target = path.join(skillsDir, skillName);
    const res = await createSymlink(skillSource, target, dryRun);
    if (res) {
      res.platform = platform;
      results.push(res);
      if (res.status === "error") {
        return { platform, results, state: { root, skills: [] } };
      }
    }
    installedSkills.push(skillName);
  }

  // Write bootstrap block into AGENTS.md
  let existingAgents = "";
  try {
    existingAgents = await fs.readFile(agentsMdPath, "utf-8");
  } catch {
    // doesn't exist — will create
  }

  const hasMarkers = existingAgents.includes(BOOTSTRAP_START);
  let needsWrite = false;
  let newContent = "";

  if (hasMarkers) {
    const currentBlock = extractBootstrapBlock(existingAgents);
    if (currentBlock !== bootstrap) {
      newContent = replaceBlock(existingAgents, bootstrap);
      needsWrite = true;
    }
  } else {
    newContent = replaceBlock(existingAgents, bootstrap);
    needsWrite = true;
  }

  if (needsWrite) {
    if (dryRun) {
      results.push({
        platform,
        target: agentsMdPath,
        status: "would-change",
        message: `Would write bootstrap block`,
      });
    } else {
      await fs.mkdir(path.dirname(agentsMdPath), { recursive: true });
      await fs.writeFile(agentsMdPath, newContent, "utf-8");
      results.push({
        platform,
        target: agentsMdPath,
        status: "changed",
        message: `Bootstrap block written`,
      });
    }
  }

  return { platform, results, state: { root, skills: installedSkills } };
}

export async function uninstallPlatform(
  platform: Platform,
  home: string,
  codexHome: string,
  stateRecord: PlatformRecord | undefined,
  repoRoot: string,
  dryRun: boolean,
): Promise<PlatformAction> {
  const root = platformRoot(home, codexHome, platform);
  const skillsDir = path.join(root, "skills");
  const agentsMdPath = path.join(root, "AGENTS.md");
  const results: OperationResult[] = [];

  // If we have state, remove tracked symlinks
  const skillsToRemove = stateRecord?.skills ?? [];
  for (const skillName of skillsToRemove) {
    const target = path.join(skillsDir, skillName);
    // For uninstall, we don't know the exact source, but we can check
    // if it points into our repo
    let existing: fs.Dirent | null = null;
    try {
      existing = await fs.lstat(target);
    } catch {
      continue;
    }
    if (existing?.isSymbolicLink()) {
      const currentTarget = await fs.readlink(target);
      const resolvedCurrent = path.resolve(path.dirname(target), currentTarget);
      // Check if it points into our repo
      if (resolvedCurrent.startsWith(repoRoot)) {
        const res = await removeSymlink(target, resolvedCurrent, dryRun);
        if (res) {
          res.platform = platform;
          results.push(res);
        }
      }
    }
  }

  // Remove bootstrap block from AGENTS.md
  try {
    const existingAgents = await fs.readFile(agentsMdPath, "utf-8");
    if (existingAgents.includes(BOOTSTRAP_START)) {
      const newContent = removeBlock(existingAgents);
      if (dryRun) {
        results.push({
          platform,
          target: agentsMdPath,
          status: "would-change",
          message: `Would remove bootstrap block`,
        });
      } else {
        await fs.writeFile(agentsMdPath, newContent, "utf-8");
        results.push({
          platform,
          target: agentsMdPath,
          status: "changed",
          message: `Bootstrap block removed`,
        });
      }
    }
  } catch {
    // no AGENTS.md — fine
  }

  return { platform, results, state: { root, skills: [] } };
}

// ── Check (drift detection) ────────────────────────────────────────────────

export async function checkPlatform(
  platform: Platform,
  home: string,
  codexHome: string,
  skills: Map<string, string>,
  stateRecord: PlatformRecord | undefined,
  repoRoot: string,
): Promise<OperationResult[]> {
  const root = platformRoot(home, codexHome, platform);
  const skillsDir = path.join(root, "skills");
  const results: OperationResult[] = [];

  // Check expected symlinks
  for (const [skillName, skillSource] of skills) {
    const target = path.join(skillsDir, skillName);
    let existing: fs.Dirent | null = null;
    try {
      existing = await fs.lstat(target);
    } catch {
      results.push({
        platform,
        target,
        status: "drift",
        message: `Missing symlink: ${skillName}`,
      });
      continue;
    }
    if (!existing.isSymbolicLink()) {
      results.push({
        platform,
        target,
        status: "drift",
        message: `${skillName} exists but is not a symlink`,
      });
      continue;
    }
    const currentTarget = await fs.readlink(target);
    const resolvedCurrent = path.resolve(path.dirname(target), currentTarget);
    if (resolvedCurrent !== skillSource) {
      results.push({
        platform,
        target,
        status: "drift",
        message: `${skillName} symlink points to ${resolvedCurrent}, expected ${skillSource}`,
      });
    }
  }

  // Check for extra managed symlinks (in state but not in skills)
  const stateSkills = new Set(stateRecord?.skills ?? []);
  const currentSkills = new Set(skills.keys());
  for (const old of stateSkills) {
    if (!currentSkills.has(old)) {
      const target = path.join(skillsDir, old);
      let existing: fs.Dirent | null = null;
      try {
        existing = await fs.lstat(target);
      } catch {
        continue;
      }
      if (existing.isSymbolicLink()) {
        const currentTarget = await fs.readlink(target);
        const resolvedCurrent = path.resolve(path.dirname(target), currentTarget);
        if (resolvedCurrent.startsWith(repoRoot)) {
          results.push({
            platform,
            target,
            status: "drift",
            message: `Stale symlink: ${old} (skill no longer exists)`,
          });
        }
      }
    }
  }

  return results;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    action: "apply",
    platforms: [...PLATFORMS],
    target: os.homedir(),
    repoRoot: REPO_ROOT,
    yes: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--apply": opts.action = "apply"; break;
      case "--uninstall": opts.action = "uninstall"; break;
      case "--dry-run": opts.action = "dry-run"; break;
      case "--check": opts.action = "check"; break;
      case "--platform": {
        const val = argv[++i];
        if (val === "all") {
          opts.platforms = [...PLATFORMS];
        } else if (PLATFORMS.includes(val as Platform)) {
          opts.platforms = [val as Platform];
        } else {
          console.error(`Unknown platform: ${val}. Valid: ${PLATFORMS.join(", ")}, all`);
          process.exit(2);
        }
        break;
      }
      case "--target": opts.target = argv[++i]; break;
      case "--repo-root": opts.repoRoot = argv[++i]; break;
      case "--yes": case "-y": opts.yes = true; break;
      case "--json": opts.json = true; break;
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

const USAGE = `massa-th0th skills installer

Usage:
  bun scripts/install-skills.ts [flags]

Flags:
  --apply                 Install skills (symlinks + bootstrap block) (default)
  --uninstall             Remove massa-th0th-owned symlinks + bootstrap block
  --dry-run               Preview changes, write nothing
  --check                 Report drift, exit 1 if found
  --platform <name>       One of: ${PLATFORMS.join(", ")}, all (default: all)
  --target <dir>          Override home directory (for tests)
  --repo-root <dir>        Override repo root detection
  --yes, -y               Consent to writing real $HOME
  --json                  Machine-readable output
  -h, --help              Show this help

Platforms install to:
  claude     ~/.claude/skills/<name>  + ~/.claude/AGENTS.md
  codex      ~/.codex/skills/<name>   + ~/.codex/AGENTS.md
  cursor    ~/.cursor/skills/<name>  + ~/.cursor/AGENTS.md
  opencode  ~/.config/opencode/skills/<name>  + ~/.config/opencode/AGENTS.md
`;

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot(opts.repoRoot);
  const home = path.resolve(opts.target);
  const codexHome = resolveCodexHome(home);

  // Safety: require --yes for real HOME (not test target)
  if (home === os.homedir() && !opts.yes && opts.action !== "dry-run" && opts.action !== "check") {
    console.error(`Refusing to write to real $HOME without --yes. Pass --yes or --target /tmp/testhome.`);
    return 1;
  }

  const dryRun = opts.action === "dry-run";

  try {
    // Discover skills and extract bootstrap
    const skills = await discoverSkillSources(repoRoot);
    const bootstrap = await extractBootstrap(repoRoot);

    // Detect installed tools
    const installedTools = detectInstalledTools(opts.platforms);

    // Filter to platforms that are installed (for apply) or all (for uninstall/check)
    let activePlatforms: Platform[];
    if (opts.action === "uninstall" || opts.action === "check") {
      activePlatforms = opts.platforms;
    } else {
      activePlatforms = opts.platforms.filter((p) => installedTools.has(p));
      if (activePlatforms.length === 0) {
        const skipped = opts.platforms.filter((p) => !installedTools.has(p));
        for (const p of skipped) {
          console.warn(`  [${PLATFORM_LABELS[p]}] skipped — tool not on PATH`);
        }
        console.error("No requested agent tools are installed.");
        return 2;
      }
      // Report skipped
      for (const p of opts.platforms) {
        if (!installedTools.has(p)) {
          console.warn(`  [${PLATFORM_LABELS[p]}] skipped — tool not on PATH`);
        }
      }
    }

    // Load state
    const sPath = statePath(home);
    let state = await loadState(sPath, home, codexHome);

    const allResults: OperationResult[] = [];
    const newState: InstallerState = {
      version: 2,
      repository: repoRoot,
      platforms: { ...state.platforms },
    };

    for (const platform of activePlatforms) {
      let actionResult: PlatformAction;

      if (opts.action === "apply" || opts.action === "dry-run") {
        actionResult = await applyPlatform(platform, home, codexHome, skills, bootstrap, dryRun);
        newState.platforms[platform] = actionResult.state;
      } else if (opts.action === "uninstall") {
        actionResult = await uninstallPlatform(platform, home, codexHome, state.platforms[platform], repoRoot, dryRun);
        delete newState.platforms[platform];
      } else {
        // check
        const checkResults = await checkPlatform(platform, home, codexHome, skills, state.platforms[platform], repoRoot);
        allResults.push(...checkResults);
        continue;
      }

      allResults.push(...actionResult.results);
    }

    // Save state (only for apply/uninstall, not dry-run or check)
    if ((opts.action === "apply" || opts.action === "uninstall") && !dryRun) {
      await saveState(sPath, newState);
    }

    // Output
    if (opts.json) {
      const hasDrift = allResults.some((r) => r.status === "drift");
      const hasError = allResults.some((r) => r.status === "error");
      const status = hasError ? "error" : hasDrift ? "drift" : allResults.some((r) => r.status === "changed" || r.status === "would-change") ? (dryRun ? "would-change" : "changed") : "ok";
      console.log(JSON.stringify({
        status,
        action: opts.action,
        platforms: activePlatforms,
        installed_tools: [...installedTools.values()].map((t) => ({ platform: t.platform, executable: t.executable, path: t.path })),
        results: allResults,
      }, null, 2));
    } else {
      const installed = [...installedTools.values()].map((t) => `${t.executable} (${t.path})`).join(", ");
      console.log(`Installed tools: ${installed || "none"}`);
      for (const result of allResults) {
        console.log(`  [${result.status}] ${PLATFORM_LABELS[result.platform]} ${result.target} — ${result.message}`);
      }
    }

    // Exit codes
    if (allResults.some((r) => r.status === "error")) return 1;
    if (opts.action === "check" && allResults.some((r) => r.status === "drift")) return 1;
    return 0;

  } catch (error) {
    if (error instanceof IntegrationError) {
      console.error(`ERROR: ${error.message}`);
      if (opts.json) {
        console.log(JSON.stringify({ status: "error", error: error.message }, null, 2));
      }
      return 2;
    }
    throw error;
  }
}

// Run only when executed directly (not when imported by tests)
if (import.meta.main) {
  process.exit(await main());
}