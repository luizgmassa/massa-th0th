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