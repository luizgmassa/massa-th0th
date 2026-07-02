import fs from "fs/promises";
import path from "path";
import {
  config,
  DEFAULT_ALLOWED_EXTENSIONS,
} from "@th0th-ai/shared/config";

export interface CollectedFile {
  relativePath: string;
  content: string;
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage",
  "__pycache__", ".next", ".nuxt", "out", ".turbo",
  "generated", ".cache", "vendor", ".svn", ".hg",
]);

const MAX_FILE_BYTES = 512 * 1024;    // 512 KB per file
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB total
const MAX_FILES = 3000;

/**
 * Resolve the allow-list from the shared config (single source of truth).
 * Falls back to the canonical default if config is unavailable or empty.
 */
function getAllowedExtensions(): Set<string> {
  try {
    const list = config.get("security").allowedExtensions;
    if (list && list.length > 0) return new Set(list);
  } catch {
    // config unavailable — fall through to canonical default
  }
  return new Set(DEFAULT_ALLOWED_EXTENSIONS);
}

export async function collectFiles(projectPath: string): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];
  const state = { totalBytes: 0 };
  const allowed = getAllowedExtensions();
  await walk(projectPath, projectPath, files, state, allowed);
  return files;
}

async function walk(
  root: string,
  dir: string,
  files: CollectedFile[],
  state: { totalBytes: number },
  allowed: Set<string>,
): Promise<void> {
  if (files.length >= MAX_FILES || state.totalBytes >= MAX_TOTAL_BYTES) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES || state.totalBytes >= MAX_TOTAL_BYTES) break;

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        await walk(root, path.join(dir, entry.name), files, state, allowed);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowed.has(ext)) continue;

      const fullPath = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        if (state.totalBytes + stat.size > MAX_TOTAL_BYTES) continue;

        const content = await fs.readFile(fullPath, "utf-8");
        state.totalBytes += stat.size;
        const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
        files.push({ relativePath, content });
      } catch {
        // skip unreadable files
      }
    }
  }
}
