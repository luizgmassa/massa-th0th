/**
 * Runtime detection — polyglot sandbox.
 *
 * Detects which language runtimes are installed on the host so the executor
 * can pick the right interpreter/compiler per language. Rewritten fresh in TS
 * (approach ported from context-mode `runtime.ts`); no code copied.
 *
 * Trust model: massa-ai is a LOCAL-DEV tool that runs user-supplied code on
 * the host. Runtime detection here is best-effort and never escalates
 * privilege — it only reports what `command -v` / `where` + a `--version`
 * probe can see on PATH.
 */

import { execFileSync, execSync } from "node:child_process";

export type Language =
  | "javascript"
  | "typescript"
  | "python"
  | "shell"
  | "ruby"
  | "go"
  | "rust"
  | "php"
  | "perl"
  | "r";

export interface RuntimeMap {
  javascript: string | null;
  typescript: string | null;
  python: string | null;
  shell: string;
  ruby: string | null;
  go: string | null;
  rust: string | null;
  php: string | null;
  perl: string | null;
  r: string | null;
}

export interface RuntimeInfo {
  command: string;
  available: boolean;
  version: string;
}

const isWindows = process.platform === "win32";

/**
 * Dependency seam so unit tests can mock the `which`-equivalent probe without
 * spawning real shells. Production callers omit it.
 */
export interface DetectDeps {
  commandExists?: (cmd: string) => boolean;
  getVersion?: (cmd: string, args?: string[]) => string;
}

/**
 * Default `command -v` / `where` probe. Returns true if the binary is on PATH.
 * Kept deliberately cheap (no --version run) — availability for routing is
 * enough; the executor itself surfaces real launch failures.
 */
export function commandExists(cmd: string): boolean {
  try {
    const check = isWindows ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(check, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stricter probe: requires `<cmd> --version` to exit 0. Filters out OS stubs
 * (e.g. the Windows Store python alias that pops the Store instead of running).
 */
export function runnableExists(
  cmd: string,
  deps?: DetectDeps,
): boolean {
  const exists = deps?.commandExists ?? commandExists;
  if (!exists(cmd)) return false;
  try {
    getVersion(cmd, ["--version"], deps);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the first line of `<cmd> --version` (or "unknown" if it can't be
 * read within a short timeout). Exported so callers/tests can inspect versions.
 */
export function getVersion(
  cmd: string,
  args: string[] = ["--version"],
  deps?: DetectDeps,
): string {
  if (deps?.getVersion) return deps.getVersion(cmd, args);
  try {
    // DEP0190: avoid args-array + shell:true on Windows.
    if (isWindows) {
      const cmdStr = [cmd, ...args]
        .map((a) => (/[\s"&|<>^()%!]/.test(a) ? JSON.stringify(a) : a))
        .join(" ");
      return execSync(cmdStr, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      })
        .trim()
        .split(/\r?\n/)[0];
    }
    return execFileSync(cmd, args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return "unknown";
  }
}

/**
 * Detect all runtimes on the host. `shell` always resolves to a fallback
 * (`sh` on POSIX, `cmd.exe` on Windows) even when nothing better is present,
 * because a shell is the one runtime we can assume exists.
 *
 * `deps` is a test seam — production callers omit it.
 */
export function detectRuntimes(deps?: DetectDeps): RuntimeMap {
  const exists = deps?.commandExists ?? commandExists;
  const runnable = (cmd: string) => runnableExists(cmd, deps);

  const shell = isWindows
    ? exists("bash")
      ? "bash"
      : "cmd.exe"
    : exists("bash")
      ? "bash"
      : "sh";

  const hasBun = exists("bun");
  // Prefer bun for JS/TS when present (faster, runs both). Fall back to node
  // for JS; tsx for TS. execPath is intentionally NOT trusted as a JS runtime
  // here — this package may be loaded inside a non-JS host binary.
  const javascript = hasBun
    ? "bun"
    : exists("node")
      ? "node"
      : null;
  const typescript = hasBun
    ? "bun"
    : exists("tsx")
      ? "tsx"
      : null;

  return {
    javascript,
    typescript,
    python: runnable("python3")
      ? "python3"
      : runnable("python")
        ? "python"
        : null,
    shell,
    ruby: exists("ruby") ? "ruby" : null,
    go: exists("go") ? "go" : null,
    rust: exists("rustc") ? "rustc" : null,
    php: exists("php") ? "php" : null,
    perl: exists("perl") ? "perl" : null,
    r: exists("Rscript") ? "Rscript" : null,
  };
}

/**
 * Human-readable summary of detected runtimes (for diagnostics / tool output).
 */
export function getRuntimeSummary(runtimes: RuntimeMap): string {
  const lines: string[] = [];
  const fmt = (label: string, cmd: string | null): string =>
    cmd
      ? `  ${label.padEnd(11)} ${cmd} (${getVersion(cmd)})`
      : `  ${label.padEnd(11)} not available`;
  lines.push(fmt("JavaScript:", runtimes.javascript));
  lines.push(fmt("TypeScript:", runtimes.typescript));
  lines.push(fmt("Python:", runtimes.python));
  lines.push(fmt("Shell:", runtimes.shell));
  if (runtimes.ruby) lines.push(fmt("Ruby:", runtimes.ruby));
  if (runtimes.go) lines.push(fmt("Go:", runtimes.go));
  if (runtimes.rust) lines.push(fmt("Rust:", runtimes.rust));
  if (runtimes.php) lines.push(fmt("PHP:", runtimes.php));
  if (runtimes.perl) lines.push(fmt("Perl:", runtimes.perl));
  if (runtimes.r) lines.push(fmt("R:", runtimes.r));
  return lines.join("\n");
}

/**
 * Languages that are actually runnable given the detected runtimes.
 */
export function getAvailableLanguages(runtimes: RuntimeMap): Language[] {
  const langs: Language[] = ["shell"];
  if (runtimes.javascript) langs.push("javascript");
  if (runtimes.typescript) langs.push("typescript");
  if (runtimes.python) langs.push("python");
  if (runtimes.ruby) langs.push("ruby");
  if (runtimes.go) langs.push("go");
  if (runtimes.rust) langs.push("rust");
  if (runtimes.php) langs.push("php");
  if (runtimes.perl) langs.push("perl");
  if (runtimes.r) langs.push("r");
  return langs;
}

/**
 * Resolve the spawn argv for a given language + temp script path. Throws a
 * clear, actionable error when the language is unavailable (so the tool layer
 * can surface it instead of an opaque ENOENT).
 *
 * Rust is special-cased with the sentinel `"__rust_compile_run__"` — the
 * executor handles compile+run itself.
 */
export function buildCommand(
  runtimes: RuntimeMap,
  language: Language,
  filePath: string,
): string[] {
  switch (language) {
    case "javascript":
      if (!runtimes.javascript) {
        throw new Error(
          "No JavaScript runtime available. Install Node.js or Bun on PATH.",
        );
      }
      return runtimes.javascript === "bun"
        ? [runtimes.javascript, "run", filePath]
        : [runtimes.javascript, filePath];

    case "typescript":
      if (!runtimes.typescript) {
        throw new Error(
          "No TypeScript runtime available. Install bun or tsx.",
        );
      }
      return runtimes.typescript === "bun"
        ? [runtimes.typescript, "run", filePath]
        : [runtimes.typescript, filePath];

    case "python":
      if (!runtimes.python) {
        throw new Error("No Python runtime available. Install python3.");
      }
      return [runtimes.python, filePath];

    case "shell":
      // On POSIX, run the script directly (it has a shebang / 0o700 mode).
      // On Windows, bash -c "source '<path>'" avoids MSYS path mangling.
      if (isWindows) {
        const escaped = filePath.replace(/'/g, `'\\''`);
        return [runtimes.shell, "-c", `source '${escaped}'`];
      }
      return [runtimes.shell, filePath];

    case "ruby":
      if (!runtimes.ruby) throw new Error("Ruby not available.");
      return [runtimes.ruby, filePath];

    case "go":
      if (!runtimes.go) throw new Error("Go not available.");
      return ["go", "run", filePath];

    case "rust":
      if (!runtimes.rust) throw new Error("Rust not available. Install rustc.");
      return ["__rust_compile_run__", filePath];

    case "php":
      if (!runtimes.php) throw new Error("PHP not available.");
      return ["php", filePath];

    case "perl":
      if (!runtimes.perl) throw new Error("Perl not available.");
      return ["perl", filePath];

    case "r":
      if (!runtimes.r) throw new Error("R not available.");
      return [runtimes.r, filePath];
  }
}

/** Temp-script file extension per language. */
export const SCRIPT_EXT: Record<Language, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  shell: "sh",
  ruby: "rb",
  go: "go",
  rust: "rs",
  php: "php",
  perl: "pl",
  r: "R",
};
