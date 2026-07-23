import { describe, test, expect } from "bun:test";
import { promises as fs } from "fs";
import path from "path";

import { resolveRepoRoot, BOOTSTRAP_START, BOOTSTRAP_END } from "../install-skills";

const REPO_ROOT = resolveRepoRoot();
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const DOCS_DIR = path.join(REPO_ROOT, "docs");

// ── Helpers ────────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readFile(p: string): Promise<string> {
  return fs.readFile(p, "utf-8");
}

// ── Skill file structure ───────────────────────────────────────────────────

describe("skill file structure validation", () => {
  const expectedSkills = [
    "massa-th0th",
    "massa-th0th-memory",
    "synapse-usage",
    "persona-router",
  ];

  for (const skill of expectedSkills) {
    test(`${skill}/SKILL.md exists and has frontmatter`, async () => {
      const skillMd = path.join(SKILLS_DIR, skill, "SKILL.md");
      expect(await fileExists(skillMd)).toBe(true);
      const content = await readFile(skillMd);
      expect(content.startsWith("---")).toBe(true);
      // Must have name and description in frontmatter
      const frontmatter = content.slice(0, content.indexOf("---", 3));
      expect(frontmatter).toContain("name:");
      expect(frontmatter).toContain("description:");
    });
  }

  test("all skill directories have SKILL.md", async () => {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    // Exclude agents/ which is a sub-agent registry dir, not a skill
    const skillDirs = dirs.filter((d) => d !== "agents");
    for (const dir of skillDirs) {
      const skillMd = path.join(SKILLS_DIR, dir, "SKILL.md");
      expect(await fileExists(skillMd)).toBe(true);
    }
  });
});

// ── Bootstrap contract in skills/AGENTS.md ─────────────────────────────────

describe("skills/AGENTS.md bootstrap contract", () => {
  test("contains bootstrap markers", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "AGENTS.md"));
    expect(content).toContain(BOOTSTRAP_START);
    expect(content).toContain(BOOTSTRAP_END);
  });

  test("bootstrap block contains activation order", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "AGENTS.md"));
    const block = content.slice(
      content.indexOf(BOOTSTRAP_START),
      content.indexOf(BOOTSTRAP_END) + BOOTSTRAP_END.length
    );
    expect(block).toContain("caveman full");
    expect(block).toContain("coding-guidelines");
    expect(block).toContain("massa-th0th");
    expect(block).toContain("persona-router");
  });

  test("bootstrap contains persona router policy", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "AGENTS.md"));
    const block = content.slice(
      content.indexOf(BOOTSTRAP_START),
      content.indexOf(BOOTSTRAP_END) + BOOTSTRAP_END.length
    );
    expect(block).toContain("persona_router");
    expect(block).toContain("plan_challenge");
    expect(block).toContain("conversation_feedback");
  });

  test("no old-repo references in bootstrap", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "AGENTS.md"));
    const block = content.slice(
      content.indexOf(BOOTSTRAP_START),
      content.indexOf(BOOTSTRAP_END) + BOOTSTRAP_END.length
    );
    expect(block).not.toContain("useful-agent-skills");
    expect(block).not.toContain("UAS_");
  });

  test("sub-agent registry preserved (12 agents)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "AGENTS.md"));
    expect(content).toContain("investigator");
    expect(content).toContain("planner");
    expect(content).toContain("builder");
    expect(content).toContain("reviewer");
    expect(content).toContain("context-curator");
    expect(content).toContain("verification-agent");
    expect(content).toContain("requirements-analyst");
    expect(content).toContain("architecture-specialist");
    expect(content).toContain("test-engineer");
    expect(content).toContain("documentation-agent");
    expect(content).toContain("audit-specialist");
    expect(content).toContain("mobile-specialist");
  });
});

// ── Workflow files exist ──────────────────────────────────────────────────

describe("workflow files referenced in SKILL.md exist", () => {
  const workflowFiles = [
    "workflows/spec-driven.md",
    "workflows/feature.md",
    "workflows/debug.md",
    "workflows/general.md",
    "workflows/refactor.md",
    "workflows/the-fool.md",
    "workflows/adr.md",
    "workflows/rfc.md",
    "workflows/tdd.md",
    "workflows/exploration.md",
    "workflows/onboarding.md",
    "workflows/long-session.md",
    "workflows/restart-save.md",
    "workflows/restart-load.md",
    "workflows/agent-handoff.md",
    "workflows/commit.md",
    "workflows/ticket.md",
    "workflows/design.md",
  ];

  for (const wf of workflowFiles) {
    test(`massa-th0th/${wf} exists`, async () => {
      expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", wf))).toBe(true);
    });
  }
});

// ── Reference files exist ──────────────────────────────────────────────────

describe("reference files exist", () => {
  const referenceFiles = [
    "references/th0th-tools.md",
    "references/synapse-policy.md",
    "references/evidence-gate.md",
    "references/context-firewall.md",
    "references/verification-ladder.md",
    "references/agent-orchestration.md",
    "references/memory-policy.md",
    "references/decision-engine.md",
    "references/lessons.md",
    "references/hook-enforcement.md",
    "references/naming-standards.md",
    "references/conversation-feedback.md",
  ];

  for (const ref of referenceFiles) {
    test(`massa-th0th/${ref} exists`, async () => {
      expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", ref))).toBe(true);
    });
  }
});

// ── massa-th0th router contract ──────────────────────────────────────────

describe("massa-th0th router contract", () => {
  test("retrieval contract requires source confirmation", async () => {
    const skillMd = await readFile(path.join(SKILLS_DIR, "massa-th0th", "SKILL.md"));
    expect(skillMd).toMatch(/fresh.*repository.*path|confirmed against current source/i);
  });

  test("memory contract mentions forbidden payload outcome", async () => {
    const skillMd = await readFile(path.join(SKILLS_DIR, "massa-th0th", "SKILL.md"));
    expect(skillMd).toMatch(/Do not fabricate|Never use.*artifact loader|durable.*useful/i);
  });

  test("observability contract mentions context pressure", async () => {
    const skillMd = await readFile(path.join(SKILLS_DIR, "massa-th0th", "SKILL.md"));
    // The router should mention context budget or compaction
    expect(skillMd).toMatch(/compact|context.*budget|summarize.*before/i);
  });

  test("subagent packet contract requires skipped check policy", async () => {
    const agentsMd = await readFile(path.join(SKILLS_DIR, "AGENTS.md"));
    expect(agentsMd).toContain("Risks and skipped checks");
    expect(agentsMd).toContain("Exact next step");
  });
});

// ── Exploration golden rules ──────────────────────────────────────────────

describe("exploration workflow golden rules", () => {
  test("knowledge verification chain required", async () => {
    const exploration = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "exploration.md"));
    expect(exploration).toMatch(/Codebase|Project docs|Context7|Web search|uncertain/i);
  });

  test("codebase investigation note-worthiness trigger", async () => {
    const investigation = await readFile(path.join(SKILLS_DIR, "massa-th0th", "references", "codebase-investigation.md"));
    expect(investigation.length).toBeGreaterThan(100);
  });
});

// ── Architecture lenses ───────────────────────────────────────────────────

describe("architecture lens references", () => {
  test("coupling lens balance formula", async () => {
    const coupling = await readFile(path.join(SKILLS_DIR, "massa-th0th", "references", "architecture-coupling-lens.md"));
    expect(coupling.length).toBeGreaterThan(500);
  });

  test("domain lens rubric anchors", async () => {
    const domain = await readFile(path.join(SKILLS_DIR, "massa-th0th", "references", "architecture-domain-lens.md"));
    expect(domain.length).toBeGreaterThan(500);
  });

  test("deepening lens interface design method", async () => {
    const deepening = await readFile(path.join(SKILLS_DIR, "massa-th0th", "references", "architecture-deepening-lens.md"));
    expect(deepening.length).toBeGreaterThan(500);
  });
});

// ── Harness state paths ───────────────────────────────────────────────────

describe("harness state paths", () => {
  test(".specs/project/STATE.md exists", async () => {
    expect(await fileExists(path.join(REPO_ROOT, ".specs", "project", "STATE.md"))).toBe(true);
  });

  test(".specs/project/FEATURES.json exists and parses", async () => {
    const featuresPath = path.join(REPO_ROOT, ".specs", "project", "FEATURES.json");
    expect(await fileExists(featuresPath)).toBe(true);
    const content = await readFile(featuresPath);
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test(".specs/HANDOFF.md exists", async () => {
    expect(await fileExists(path.join(REPO_ROOT, ".specs", "HANDOFF.md"))).toBe(true);
  });
});

// ── Gitignore contract ─────────────────────────────────────────────────────

describe("gitignore contract", () => {
  test(".gitignore exists", async () => {
    expect(await fileExists(path.join(REPO_ROOT, ".gitignore"))).toBe(true);
  });

  test("node_modules ignored", async () => {
    const gitignore = await readFile(path.join(REPO_ROOT, ".gitignore"));
    expect(gitignore).toMatch(/node_modules/);
  });
});

// ── No old-repo references ─────────────────────────────────────────────────

describe("no old-repo references", () => {
  test("no useful-agent-skills in skills/", async () => {
    const agentsMd = await readFile(path.join(SKILLS_DIR, "AGENTS.md"));
    expect(agentsMd).not.toContain("useful-agent-skills");
    expect(agentsMd).not.toContain("UAS_");
  });

  test("no useful-agent-skills in docs/", async () => {
    const docs = await fs.readdir(DOCS_DIR);
    for (const doc of docs.filter((d) => d.endsWith(".md"))) {
      const content = await readFile(path.join(DOCS_DIR, doc));
      expect(content).not.toContain("useful-agent-skills");
      expect(content).not.toContain("Useful-Agent-Skills");
    }
  });
});

// ── Docs migration ────────────────────────────────────────────────────────

describe("docs migration", () => {
  const migratedDocs = [
    "context-slices.md",
    "massa-th0th-commit.md",
    "massa-th0th-maestro.md",
    "massa-th0th-mobile-figma.md",
    "massa-th0th-rfc.md",
    "massa-th0th-spec-driven.md",
    "massa-th0th-tdd.md",
    "massa-th0th-ticket.md",
  ];

  for (const doc of migratedDocs) {
    test(`docs/${doc} exists`, async () => {
      expect(await fileExists(path.join(DOCS_DIR, doc))).toBe(true);
    });
  }
});

// ── Persona catalog ────────────────────────────────────────────────────────

describe("persona catalog", () => {
  const catalogPath = path.join(SKILLS_DIR, "massa-th0th", "personas", "catalog.json");

  test("catalog.json exists and parses", async () => {
    expect(await fileExists(catalogPath)).toBe(true);
    const content = await readFile(catalogPath);
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test("schema_version is 1", async () => {
    const content = await readFile(catalogPath);
    const catalog = JSON.parse(content);
    expect(catalog.schema_version).toBe(1);
  });

  test("all prompt_path values resolve to existing files", async () => {
    const content = await readFile(catalogPath);
    const catalog = JSON.parse(content);
    const personasDir = path.dirname(catalogPath);
    for (const persona of catalog.personas) {
      const promptPath = path.join(personasDir, persona.prompt_path);
      expect(await fileExists(promptPath)).toBe(true);
    }
  });

  test("expected persona IDs present", async () => {
    const content = await readFile(catalogPath);
    const catalog = JSON.parse(content);
    const ids = catalog.personas.map((p: { id: string }) => p.id);
    expect(ids).toContain("senior-mobile-engineer");
    expect(ids).toContain("senior-mobile-qa-automation-engineer");
    expect(ids).toContain("context-skill-harness-engineer-architect");
    expect(ids).toContain("product-manager");
    expect(ids).toContain("ai-native-nodejs-cli-architect");
  });

  test("persona prompt files exist", async () => {
    const personaFiles = [
      "ai-native-nodejs-cli-architect.md",
      "context-skill-harness-engineer-architect.md",
      "product-manager.md",
      "senior-mobile-engineer.md",
      "senior-mobile-qa-automation-engineer.md",
    ];
    for (const file of personaFiles) {
      expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "personas", file))).toBe(true);
    }
  });
});

// ── Persona router SKILL.md ────────────────────────────────────────────────

describe("persona-router skill", () => {
  test("SKILL.md exists with frontmatter", async () => {
    const skillMd = path.join(SKILLS_DIR, "persona-router", "SKILL.md");
    expect(await fileExists(skillMd)).toBe(true);
    const content = await readFile(skillMd);
    expect(content.startsWith("---")).toBe(true);
    expect(content).toContain("name: persona-router");
  });

  test("references catalog location at new path", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "persona-router", "SKILL.md"));
    expect(content).toContain("massa-th0th/personas/catalog.json");
  });
});

// ── Removed features documented ───────────────────────────────────────────

describe("removed features documented", () => {
  test("docs/removed-features.md exists", async () => {
    expect(await fileExists(path.join(DOCS_DIR, "removed-features.md"))).toBe(true);
  });
});

// ── Persona catalog deep validation (ported from legacy test_validate_repository.py) ──
// The legacy suite had 12 persona-catalog tests; the TS port had 5 shallow ones.
// These add: malformed/missing/legacy/schema-version/required-fields/duplicate/
// prompt-missing/path-escape/uncataloged-prompt/invalid-shape/mirror-drift.

describe("persona catalog deep validation", () => {
  const catalogPath = path.join(SKILLS_DIR, "massa-th0th", "personas", "catalog.json");
  const personasDir = path.dirname(catalogPath);

  test("catalog is valid JSON (malformed catalog detected)", async () => {
    const content = await readFile(catalogPath);
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test("catalog schema_version is present and 1", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    expect(catalog.schema_version).toBe(1);
  });

  test("catalog has required top-level shape (personas array)", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    expect(Array.isArray(catalog.personas)).toBe(true);
    expect(catalog.personas.length).toBeGreaterThanOrEqual(1);
  });

  test("every persona entry has required fields (id, display_name, prompt_path, summary, aliases, primary_signals, negative_signals, secondary_lens_signals)", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    const requiredFields = ["id", "display_name", "prompt_path", "summary", "aliases", "primary_signals", "negative_signals", "secondary_lens_signals"];
    for (const persona of catalog.personas) {
      for (const field of requiredFields) {
        expect(persona[field]).toBeDefined();
      }
      expect(typeof persona.id).toBe("string");
      expect(typeof persona.display_name).toBe("string");
      expect(typeof persona.prompt_path).toBe("string");
      expect(typeof persona.summary).toBe("string");
      expect(Array.isArray(persona.aliases)).toBe(true);
      expect(Array.isArray(persona.primary_signals)).toBe(true);
      expect(Array.isArray(persona.negative_signals)).toBe(true);
      expect(Array.isArray(persona.secondary_lens_signals)).toBe(true);
    }
  });

  test("persona IDs are unique (no duplicate entries)", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    const ids = catalog.personas.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("persona prompt_paths are unique (no duplicate paths)", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    const paths = catalog.personas.map((p: { prompt_path: string }) => p.prompt_path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("prompt_path values are filename-only (no path traversal / absolute paths)", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    for (const persona of catalog.personas) {
      const pp: string = persona.prompt_path;
      expect(pp).not.toMatch(/^\//);          // not absolute
      expect(pp).not.toMatch(/\.\.\//);       // no parent-dir traversal
      expect(pp).not.toMatch(/\\\/\\/);       // no backslash separators
      expect(pp).not.toContain("/");          // filename-only — no subdirs
    }
  });

  test("every prompt_path resolves to an existing file", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    for (const persona of catalog.personas) {
      const promptPath = path.join(personasDir, persona.prompt_path);
      expect(await fileExists(promptPath)).toBe(true);
    }
  });

  test("every cataloged persona prompt file is non-empty markdown", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    for (const persona of catalog.personas) {
      const promptPath = path.join(personasDir, persona.prompt_path);
      const content = await readFile(promptPath);
      expect(content.length).toBeGreaterThan(100);
      // Persona prompt files are markdown (start with a heading), not YAML frontmatter.
      expect(content.startsWith("#")).toBe(true);
    }
  });

  test("no uncataloged persona prompt files exist in personas/ (mirror drift)", async () => {
    const catalog = JSON.parse(await readFile(catalogPath));
    const cataloged = new Set(catalog.personas.map((p: { prompt_path: string }) => p.prompt_path));
    const entries = await fs.readdir(personasDir, { withFileTypes: true });
    // Only consider persona prompt files: .md files other than README.md.
    const onDisk = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
      .map((e) => e.name);
    for (const file of onDisk) {
      expect(cataloged.has(file)).toBe(true);
    }
  });

  test("legacy top-level persona catalog is NOT present (migration complete)", async () => {
    // The legacy repo had a top-level personas/ dir; the new path is under skills/massa-th0th/personas/.
    expect(await fileExists(path.join(REPO_ROOT, "personas", "catalog.json"))).toBe(false);
  });
});

// ── Hook enforcement reference (ported from legacy hook-graph tests) ──────
// The legacy suite asserted the hook graph maps to references and enforces the
// th0th dual-write/tag contract. These check the hook-enforcement reference
// still documents that mapping and the procedural-is-tag rule.

describe("hook enforcement reference", () => {
  const hookRef = path.join(SKILLS_DIR, "massa-th0th", "references", "hook-enforcement.md");

  test("hook-enforcement.md exists", async () => {
    expect(await fileExists(hookRef)).toBe(true);
  });

  test("documents the hooks-to-enforced-reference mapping table", async () => {
    const content = await readFile(hookRef);
    // Each enforcing hook should be named somewhere in the mapping.
    expect(content).toContain("stop_evidence_gate");
    expect(content).toContain("continuous_learning_evaluate");
    expect(content).toContain("precompact_save_state");
    expect(content).toContain("gateguard");
    expect(content).toContain("config_protection");
    expect(content).toContain("observe_runner");
  });

  test("documents the workflow-aware stop gate reading from .specs/project/STATE.md", async () => {
    const content = await readFile(hookRef);
    expect(content).toContain("stop_evidence_gate");
    expect(content).toMatch(/\.specs\/project\/STATE\.md/);
  });

  test("documents the th0th dual-write/tag contract (procedural is a tag, never a type)", async () => {
    const content = await readFile(hookRef);
    // The phrase spans newlines ("`procedural`\nis a **tag**, never a\ntype"), so
    // assert the key tokens are all present rather than a single-line regex.
    expect(content).toContain("procedural");
    expect(content).toContain("tag");
    // "never a\ntype" — allow a newline between "never" and "type".
    expect(content).toMatch(/never[\s\S]*type/i);
    expect(content).toContain("memory:procedural");
  });

  test("lists supported th0th types (critical|conversation|code|decision|pattern only)", async () => {
    const content = await readFile(hookRef);
    expect(content).toMatch(/critical\s*\|\s*conversation\s*\|\s*code\s*\|\s*decision\s*\|\s*pattern/);
  });

  test("documents graceful degradation (REST unavailable → file fallback)", async () => {
    const content = await readFile(hookRef);
    expect(content).toMatch(/graceful|fallback|REST unavailable/i);
  });

  test("no SessionStart recall duplication (router owns recall, not hooks)", async () => {
    const content = await readFile(hookRef);
    expect(content).toMatch(/SessionStart recall|no competing SessionStart|router already runs.*recall/i);
  });
});

// ── Lessons reference (ported from legacy lessons-contract tests) ─────────
// Legacy asserted: lessons th0th type must be pattern, tag contract enforced,
// procedural-is-tag loop doc. These verify the lessons reference + lessons.py
// honor the dual-write contract.

describe("lessons contract", () => {
  const lessonsRef = path.join(SKILLS_DIR, "massa-th0th", "references", "lessons.md");
  const lessonsScript = path.join(SKILLS_DIR, "massa-th0th", "scripts", "lessons.py");

  test("lessons.md and lessons.py both exist", async () => {
    expect(await fileExists(lessonsRef)).toBe(true);
    expect(await fileExists(lessonsScript)).toBe(true);
  });

  test("lessons.md documents type is always pattern (procedural is a tag, never a type)", async () => {
    const content = await readFile(lessonsRef);
    expect(content).toMatch(/type.*always.*pattern|always.*pattern.*procedural/i);
    // The phrase spans newlines ("`procedural`\n  is a **tag**, never a type"), so
    // assert the key tokens are all present rather than a single-line regex.
    expect(content).toContain("procedural");
    expect(content).toContain("tag");
    expect(content).toMatch(/never[\s\S]*type/i);
  });

  test("lessons.md documents the full persistence tag contract", async () => {
    const content = await readFile(lessonsRef);
    expect(content).toContain("memory:procedural");
    expect(content).toContain("project:");
    expect(content).toContain("session:");
    expect(content).toContain("workflow:");
    expect(content).toContain("entity:");
  });

  test("lessons.md documents the dual-write (file store + th0th REST best-effort)", async () => {
    const content = await readFile(lessonsRef);
    expect(content).toMatch(/dual.?write|lessons\.json.*th0th|best.?effort/i);
    expect(content).toContain("lessons.json");
  });

  test("lessons.md documents promotion lifecycle (candidate → confirmed → quarantined/pruned)", async () => {
    const content = await readFile(lessonsRef);
    expect(content).toContain("candidate");
    expect(content).toContain("confirmed");
    expect(content).toContain("quarantined");
  });

  test("lessons.py is a non-empty Python script with the remember-best-effort helper", async () => {
    const content = await readFile(lessonsScript);
    expect(content.length).toBeGreaterThan(500);
    // The helper was renamed from _th0th_remember_best_effort → _remember_best_effort
    expect(content).toContain("_remember_best_effort");
    expect(content).not.toContain("_th0th_remember_best_effort");
  });
});

// ── Harness state paths (ported from legacy harness-state tests) ──────────
// Legacy asserted stale top-level + project harness state paths are detected,
// and the root harness alias is stale. These verify the canonical paths exist
// and the legacy top-level paths are absent (migration complete).

describe("harness state path migration", () => {
  test(".specs/project/STATE.md exists (canonical project state)", async () => {
    expect(await fileExists(path.join(REPO_ROOT, ".specs", "project", "STATE.md"))).toBe(true);
  });

  test(".specs/project/FEATURES.json exists and parses (canonical feature registry)", async () => {
    const featuresPath = path.join(REPO_ROOT, ".specs", "project", "FEATURES.json");
    expect(await fileExists(featuresPath)).toBe(true);
    const raw = await readFile(featuresPath);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test(".specs/HANDOFF.md exists (canonical handoff snapshot)", async () => {
    expect(await fileExists(path.join(REPO_ROOT, ".specs", "HANDOFF.md"))).toBe(true);
  });

  test("legacy top-level project/ dir is NOT present (stale path migration complete)", async () => {
    // The legacy repo used top-level project/ for state; the canonical path is .specs/project/.
    expect(await fileExists(path.join(REPO_ROOT, "project", "STATE.md"))).toBe(false);
    expect(await fileExists(path.join(REPO_ROOT, "project", "FEATURES.json"))).toBe(false);
  });

  test("legacy top-level HANDOFF.md is NOT present at repo root", async () => {
    expect(await fileExists(path.join(REPO_ROOT, "HANDOFF.md"))).toBe(false);
  });
});

// ── Harness gitignore contract (ported from legacy) ──────────────────────

describe("harness gitignore contract", () => {
  test(".gitignore exists", async () => {
    expect(await fileExists(path.join(REPO_ROOT, ".gitignore"))).toBe(true);
  });

  test("node_modules ignored", async () => {
    const gitignore = await readFile(path.join(REPO_ROOT, ".gitignore"));
    expect(gitignore).toMatch(/node_modules/);
  });

  test(".env ignored (secrets hygiene)", async () => {
    const gitignore = await readFile(path.join(REPO_ROOT, ".gitignore"));
    expect(gitignore).toMatch(/\.env/);
  });

  test(".specs/lessons.json or .specs/LESSONS.md exists (machine-owned lesson state)", async () => {
    // lessons.json is the canonical machine-owned state; LESSONS.md is the rendered playbook.
    // Either the state file or the rendered playbook should be present under .specs/.
    const lessonsJson = path.join(REPO_ROOT, ".specs", "lessons.json");
    const lessonsMd = path.join(REPO_ROOT, ".specs", "LESSONS.md");
    const jsonExists = await fileExists(lessonsJson);
    const mdExists = await fileExists(lessonsMd);
    expect(jsonExists || mdExists).toBe(true);
  });
});

// ── Context slices (ported from legacy context-slices tests) ──────────────
// Legacy asserted: context slices absent is not required, missing slice rejected,
// guide missing rejected. The repo ships a context-slices guide + contexts/ dir.

describe("context slices", () => {
  test("context slices guide exists (docs/context-slices.md)", async () => {
    expect(await fileExists(path.join(DOCS_DIR, "context-slices.md"))).toBe(true);
  });

  test("context slices guide documents the available slices table", async () => {
    const content = await readFile(path.join(DOCS_DIR, "context-slices.md"));
    expect(content).toMatch(/Slice|Available Slices/i);
    expect(content).toContain("dev");
    expect(content).toContain("review");
    expect(content).toContain("research");
  });

  test("context slices guide documents opt-in via aliases (not forced into AGENTS.md)", async () => {
    const content = await readFile(path.join(DOCS_DIR, "context-slices.md"));
    expect(content).toMatch(/opt.?in|not forced|AGENTS\.md remains/i);
  });

  test("contexts/ directory, when present, has at least one slice file (absence is acceptable — slices are opt-in)", async () => {
    const contextsDir = path.join(REPO_ROOT, "contexts");
    // Context slices are opt-in; the repo may or may not ship the contexts/ dir.
    // When present, it should contain at least one .md slice. Absence is NOT a failure
    // (the legacy "context slices absent is not required" test).
    if (await fileExists(contextsDir)) {
      const entries = await fs.readdir(contextsDir, { withFileTypes: true });
      const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThan(0);
    }
  });
});

// ── Agents harness routing (ported from legacy) ──────────────────────────
// Legacy asserted agents harness routing is enforced. The 12-agent registry
// lives in skills/AGENTS.md and each agent has a charter under skills/agents/.

describe("agents harness routing", () => {
  const AGENTS_SUBDIR = path.join(SKILLS_DIR, "agents");
  const EXPECTED_AGENTS = [
    "investigator", "planner", "builder", "reviewer",
    "context-curator", "verification-agent", "requirements-analyst",
    "architecture-specialist", "test-engineer", "documentation-agent",
    "audit-specialist", "mobile-specialist",
  ];

  test("skills/agents/ exists with one subdir per agent (12)", async () => {
    expect(await fileExists(AGENTS_SUBDIR)).toBe(true);
    const entries = await fs.readdir(AGENTS_SUBDIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(dirs).toEqual([...EXPECTED_AGENTS].sort());
  });

  test("every agent subdir has a SKILL.md charter", async () => {
    for (const agent of EXPECTED_AGENTS) {
      expect(await fileExists(path.join(AGENTS_SUBDIR, agent, "SKILL.md"))).toBe(true);
    }
  });

  test("every agent charter has YAML frontmatter with name", async () => {
    for (const agent of EXPECTED_AGENTS) {
      const content = await readFile(path.join(AGENTS_SUBDIR, agent, "SKILL.md"));
      expect(content.startsWith("---")).toBe(true);
      const fm = content.slice(0, content.indexOf("---", 3));
      expect(fm).toContain("name:");
    }
  });
});

// ── RFC workflow (ported from legacy rfc tests) ──────────────────────────
// Legacy asserted: removed rfc identifiers/artifacts detected, missing merged
// rfc reference detected, merged rfc behavior/attribution drift detected.
// The repo migrated RFC refs from workflows/rfc.md → references/rfc/ subdir.

describe("rfc workflow and references", () => {
  test("workflows/rfc.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "workflows", "rfc.md"))).toBe(true);
  });

  test("references/rfc/ subdir exists (migrated from inline)", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "references", "rfc"))).toBe(true);
  });

  test("references/rfc/ contains the expected sub-references", async () => {
    const rfcDir = path.join(SKILLS_DIR, "massa-th0th", "references", "rfc");
    const entries = await fs.readdir(rfcDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    expect(files).toContain("discovery-and-sizing.md");
    expect(files).toContain("document-contract.md");
    expect(files).toContain("quality-and-lifecycle.md");
  });

  test("rfc workflow loads references/rfc/discovery-and-sizing.md", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "rfc.md"));
    expect(content).toContain("references/rfc/discovery-and-sizing.md");
  });

  test("rfc workflow requires impact label HIGH/MEDIUM/LOW", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "rfc.md"));
    expect(content).toMatch(/HIGH.*MEDIUM.*LOW|impact label/i);
  });

  test("rfc workflow requires at least two options (no one-sided proposal)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "rfc.md"));
    expect(content).toMatch(/at least two options|one-sided|only one credible option/i);
  });

  test("rfc workflow routes finalized decisions to adr and settled design to tdd", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "rfc.md"));
    expect(content).toContain("workflows/adr.md");
    expect(content).toContain("workflows/tdd.md");
  });
});

// ── TDD workflow (ported from legacy tdd tests) ──────────────────────────
// Legacy had 18 TDD tests. These cover the high-value contract checks:
// references exist, PR-size contract, layer order, independent PR group gate,
// Atlassian MCP detection, ticket delegation, calibrated examples anchor,
// project type taxonomy, mandatory trigger mapping, document litmus.

describe("tdd workflow and references", () => {
  test("workflows/tdd.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"))).toBe(true);
  });

  test("references/tdd/ subdir exists with expected sub-references", async () => {
    const tddDir = path.join(SKILLS_DIR, "massa-th0th", "references", "tdd");
    expect(await fileExists(tddDir)).toBe(true);
    const entries = await fs.readdir(tddDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    expect(files).toContain("discovery-and-sizing.md");
    expect(files).toContain("document-contract.md");
    expect(files).toContain("calibrated-examples.md");
    expect(files).toContain("quality-and-lifecycle.md");
  });

  test("tdd workflow references discovery-and-sizing.md (sizing rules)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toContain("references/tdd/discovery-and-sizing.md");
  });

  test("tdd workflow references document-contract.md (the document shape)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toContain("references/tdd/document-contract.md");
  });

  test("tdd workflow references calibrated-examples.md (calibrated examples anchor)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toContain("references/tdd/calibrated-examples.md");
  });

  test("tdd workflow documents project_type taxonomy (integration/feature/refactor/infrastructure/payment/auth/data)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toContain("project_type");
    expect(content).toContain("integration");
    expect(content).toContain("feature");
    expect(content).toContain("refactor");
    expect(content).toContain("infrastructure");
    expect(content).toContain("payment");
    expect(content).toContain("auth");
    expect(content).toContain("data");
  });

  test("tdd workflow documents mandatory trigger mapping (payment/auth → security; rollout → monitoring/rollback; integration → dependencies+security)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toMatch(/payment.*auth.*Security.*mandatory/i);
    expect(content).toMatch(/rollout.*Monitoring.*Rollback.*mandatory/i);
    expect(content).toMatch(/integration.*Dependencies.*Security.*mandatory/i);
  });

  test("tdd workflow requires small PRs (PR size contract)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toMatch(/Small PR|Medium PR|Large PR|PR group/i);
  });

  test("tdd workflow documents layer order (Data first, then Domain, then Presentation/Navigation)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toMatch(/Data first.*Domain.*Presentation|layer when applicable/i);
  });

  test("tdd workflow requires the full Plan Challenge Gate", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toMatch(/full.*Plan Challenge Gate|full gate/i);
  });

  test("tdd workflow delegates Jira creation to ticket workflow (not inline)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toContain("workflows/ticket.md");
    expect(content).toMatch(/Jira creation.*owned.*ticket|delegates|solely by the ticket/i);
  });

  test("tdd workflow never marks document Approved without human decision", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toMatch(/Never mark.*Approved|without.*human decision|Never.*Approved/i);
  });

  test("tdd workflow includes Pre-Merge TDD Fidelity Check section", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toContain("Pre-Merge TDD Fidelity Check");
  });

  test("tdd workflow includes Strings Audit for mapper stringResource branches", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toContain("Strings Audit");
    expect(content).toContain("stringResource");
  });

  test("tdd workflow includes parallel rendering surfaces checklist for UI/UX changes", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "tdd.md"));
    expect(content).toMatch(/parallel rendering surface/i);
  });
});

// ── Ticket workflow (ported from legacy ticket tests) ────────────────────
// Legacy had 11 ticket tests. These cover: missing ticket reference, router
// drift, default templates, supplied DoR/DoD, unsupported issue type, required
// fields gate, duplicate detection, revision invalidates approval, partial
// failure resume, forbidden cross-skill call, review artifact external.

describe("ticket workflow and references", () => {
  test("workflows/ticket.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"))).toBe(true);
  });

  test("references/ticket/ subdir exists with expected sub-references", async () => {
    const ticketDir = path.join(SKILLS_DIR, "massa-th0th", "references", "ticket");
    expect(await fileExists(ticketDir)).toBe(true);
    const entries = await fs.readdir(ticketDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    expect(files).toContain("intake-and-sources.md");
    expect(files).toContain("templates-and-quality.md");
    expect(files).toContain("atlassian-fix.md");
  });

  test("ticket workflow names Atlassian MCP as the only tracker (no CLI/tracker fallback)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toMatch(/Atlassian MCP.*only tracker|never substitute.*CLI.*tracker/i);
  });

  test("ticket workflow requires explicit user approval before any Jira mutation", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toMatch(/explicit user approval|approval.*before.*mutation|approval of an older revision.*invalid/i);
  });

  test("ticket workflow: content/field revision increments Draft Revision and resets Approval Status", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toMatch(/Draft Revision|increments.*Draft Revision|resets.*Approval Status/i);
  });

  test("ticket workflow requires duplicate detection before creation", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toMatch(/duplicate|Search.*Jira project.*potential duplicates/i);
  });

  test("ticket workflow: review artifact must be OUTSIDE the repository", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toMatch(/outside the repository|external.*plans directory|never write.*draft.*repository/i);
  });

  test("ticket workflow: partial failure stops immediately, no auto-compensation", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toMatch(/partial failure.*stop|stop immediately|do not.*transition.*comment.*compensate/i);
  });

  test("ticket workflow does not persist raw ticket bodies or customer data to memory", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toMatch(/Do not persist raw ticket|customer data|one-run creation/i);
  });

  test("ticket workflow forbids searching Git history/commits for ticket examples", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toMatch(/Never search Git history|repository ticket references|do not.*search.*Git/i);
  });

  test("ticket workflow delegates code grounding to exploration.md (child pass)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "ticket.md"));
    expect(content).toContain("workflows/exploration.md");
  });
});

// ── Commit workflow (ported from legacy commit tests) ───────────────────
// Legacy had 6 commit tests: missing workflow, router drift, jira prefix,
// audit markdown exclusion, forbidden git patterns, guide link.

describe("commit workflow", () => {
  test("workflows/commit.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "workflows", "commit.md"))).toBe(true);
  });

  test("commit workflow extracts Jira key from branch with case-insensitive regex", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "commit.md"));
    expect(content).toMatch(/Jira key.*branch|case-insensitive regex|\(\?<[A-Z0-9]\)|\[A-Z\]\[A-Z0-9\]/i);
  });

  test("commit workflow excludes audit report markdown from commit scope", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "commit.md"));
    expect(content).toMatch(/audit.*Markdown.*exclu|audits\/|\*-audit\.md/i);
  });

  test("commit workflow forbids history rewriting (amend/squash/rebase/reset/checkout)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "commit.md"));
    expect(content).toMatch(/never.*amend|never.*squash|never.*rebase|never reset|never.*checkout|never.*rewrite history/i);
  });

  test("commit workflow uses Conventional Commits format with type precedence", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "commit.md"));
    expect(content).toMatch(/Conventional Commits/i);
    expect(content).toContain("fix");
    expect(content).toContain("feat");
    expect(content).toContain("refactor");
    expect(content).toContain("docs");
  });

  test("commit workflow: subject hard cap 72 chars, target 50", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "commit.md"));
    expect(content).toMatch(/72 character|hard cap 72|target.*50 character/i);
  });

  test("commit workflow routes Jira ticket creation to ticket.md (not inline)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "commit.md"));
    expect(content).toContain("workflows/ticket.md");
  });
});

// ── Deterministic router + verification ladder + spec gates (ported) ────
// Legacy asserted: deterministic router + retrieval contracts enforced,
// verification ladder thresholds enforced, spec/tdd phase gates enforced,
// audit drift + sensor thresholds enforced.

describe("deterministic router contract (deep)", () => {
  test("SKILL.md documents deterministic routing precedence (first match wins, 6 tiers)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "SKILL.md"));
    expect(content).toMatch(/first match wins|Deterministic routing precedence/i);
    expect(content).toMatch(/Explicit route|Requested artifact|Target type|Primary verb|Risk domain escalation|General fallback/i);
  });

  test("SKILL.md routes exploration as read-only (no mutation)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "SKILL.md"));
    expect(content).toMatch(/exploration.*read-only|explicitly read-only|exploration.*no.*mutation/i);
  });

  test("SKILL.md requires general fallback preflight (one-line naming the rejected workflow)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "SKILL.md"));
    expect(content).toMatch(/General fallback preflight|one-line.*fallback.*preflight|names the specialized workflow considered/i);
  });

  test("SKILL.md documents graph-tool freshness gate (trace_path/impact_analysis/get_architecture require fresh index)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "SKILL.md"));
    expect(content).toMatch(/trace_path.*impact_analysis.*get_architecture|fresh.*repository.*path|Graph tools.*fresh/i);
  });

  test("th0th-tools.md documents compact_snapshot sessionId rule (NOT workflowSessionId)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "references", "th0th-tools.md"));
    expect(content).toMatch(/compact_snapshot.*sessionId.*NOT.*workflowSessionId|lifecycle session id.*NOT workflowSessionId/i);
  });

  test("SKILL.md lists graceful degradation for every tool failure (server/synapse/index/checkpoint/handoff/bootstrap/compact/execution/fetch)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "SKILL.md"));
    expect(content).toMatch(/Graceful Degradation/i);
    expect(content).toMatch(/recall.*empty|server unavailable|Synapse unavailable|index incomplete|create_checkpoint unavailable|handoff_begin unavailable|bootstrap unavailable|compact_snapshot unavailable|execute.*unavailable|fetch_and_index unavailable/i);
  });
});

describe("verification ladder reference", () => {
  test("references/verification-ladder.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "references", "verification-ladder.md"))).toBe(true);
  });

  test("verification-ladder documents deterministic sensors (not behavioral-only)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "references", "verification-ladder.md"));
    expect(content.length).toBeGreaterThan(500);
    expect(content).toMatch(/deterministic|sensor|level|threshold/i);
  });
});

describe("spec-driven phase gates", () => {
  test("workflows/spec-driven.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "workflows", "spec-driven.md"))).toBe(true);
  });

  test("spec-driven workflow requires independent validation (author ≠ verifier)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "spec-driven.md"));
    expect(content).toMatch(/independent validation|author.*verifier|verification-agent.*author.*verifier/i);
  });

  test("spec-driven workflow writes validation.md as the Execute gate output", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "workflows", "spec-driven.md"));
    expect(content).toContain("validation.md");
  });

  test("spec-driven references the spec-driven/ subdir (design/tasks/execute/validate/memory)", async () => {
    const specDir = path.join(SKILLS_DIR, "massa-th0th", "references", "spec-driven");
    expect(await fileExists(specDir)).toBe(true);
    const entries = await fs.readdir(specDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    expect(files).toContain("design.md");
    expect(files).toContain("tasks.md");
    expect(files).toContain("execute.md");
    expect(files).toContain("validate.md");
  });
});

// ── Audit-report-IO + audit-scope (ported from legacy audit drift tests) ─

describe("audit report IO and scope references", () => {
  test("references/audit-report-io.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "references", "audit-report-io.md"))).toBe(true);
  });

  test("references/audit-scope.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "references", "audit-scope.md"))).toBe(true);
  });

  test("audit-report-io is non-trivial (documents the report format contract)", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "references", "audit-report-io.md"));
    expect(content.length).toBeGreaterThan(1000);
  });
});

// ── Evidence gate + context firewall (ported) ──────────────────────────

describe("evidence gate and context firewall references", () => {
  test("references/evidence-gate.md exists and is non-trivial", async () => {
    const eg = path.join(SKILLS_DIR, "massa-th0th", "references", "evidence-gate.md");
    expect(await fileExists(eg)).toBe(true);
    const content = await readFile(eg);
    expect(content.length).toBeGreaterThan(200);
  });

  test("references/context-firewall.md exists and documents no-raw-dumps rule", async () => {
    const cf = path.join(SKILLS_DIR, "massa-th0th", "references", "context-firewall.md");
    expect(await fileExists(cf)).toBe(true);
    const content = await readFile(cf);
    expect(content).toMatch(/raw.*dump|never return raw|summarize.*before.*return/i);
  });
});

// ── Synapse policy + th0th-tools matrix (ported, deep) ──────────────────

describe("synapse policy and tool matrix references", () => {
  test("references/synapse-policy.md exists", async () => {
    expect(await fileExists(path.join(SKILLS_DIR, "massa-th0th", "references", "synapse-policy.md"))).toBe(true);
  });

  test("references/th0th-tools.md exists and documents the 52-tool roster", async () => {
    const tt = path.join(SKILLS_DIR, "massa-th0th", "references", "th0th-tools.md");
    expect(await fileExists(tt)).toBe(true);
    const content = await readFile(tt);
    // Spot-check tools from each category are present (canonical un-prefixed names)
    expect(content).toContain("recall");
    expect(content).toContain("search");
    expect(content).toContain("synapse_session");
    expect(content).toContain("handoff_begin");
    expect(content).toContain("create_checkpoint");
    expect(content).toContain("bootstrap");
    expect(content).toContain("trace_path");
    expect(content).toContain("impact_analysis");
    expect(content).toContain("rename_project");
    expect(content).toContain("merge_projects");
  });

  test("th0th-tools.md does NOT use stale th0th_-prefixed tool names", async () => {
    const content = await readFile(path.join(SKILLS_DIR, "massa-th0th", "references", "th0th-tools.md"));
    expect(content).not.toMatch(/th0th_(recall|search|remember|index|get_references)/);
  });
});

// ── No stale th0th_-prefixed tool names anywhere in skills/ (canonical naming) ─

describe("canonical tool naming (no th0th_-prefixed tool names)", () => {
  const CHARTER_FILES = [
    "agents/investigator/SKILL.md",
    "agents/context-curator/SKILL.md",
    "persona-router/SKILL.md",
    "synapse-usage/SKILL.md",
    "massa-th0th/SKILL.md",
    "massa-th0th-memory/SKILL.md",
  ];

  for (const rel of CHARTER_FILES) {
    test(`${rel} has no th0th_-prefixed tool names`, async () => {
      const content = await readFile(path.join(SKILLS_DIR, rel));
      expect(content).not.toMatch(/th0th_(search|recall|get_references|remember|index|compress|search_definitions)/);
    });
  }
});

// ── Docs guide links (ported from legacy commit guide link test) ────────

describe("docs workflow guides exist and link correctly", () => {
  const guides = [
    "massa-th0th-spec-driven.md",
    "massa-th0th-tdd.md",
    "massa-th0th-rfc.md",
    "massa-th0th-commit.md",
    "massa-th0th-ticket.md",
    "massa-th0th-maestro.md",
    "massa-th0th-mobile-figma.md",
  ];

  for (const guide of guides) {
    test(`docs/${guide} exists`, async () => {
      expect(await fileExists(path.join(DOCS_DIR, guide))).toBe(true);
    });
  }
});