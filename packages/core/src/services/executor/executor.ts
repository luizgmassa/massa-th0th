/**
 * PolyglotExecutor — spawn user code in a detected runtime.
 *
 * Approach ported from context-mode `PolyglotExecutor` (rewritten fresh in TS;
 * no source copied). One temp script is written per language, the resolved
 * runtime is spawned with it, stdout/stderr are streamed to a byte cap, and a
 * timeout kills the whole process group on expiry.
 *
 * SECURITY / TRUST MODEL (read before extending):
 *   massa-th0th is a LOCAL-DEV tool. `execute` / `execute_file` run
 *   USER-SUPPLIED code ON THE HOST — there is no OS-level sandbox (no
 *   seccomp, no namespaces, no cgroups). Containment is BEST-EFFORT:
 *     - default `cwd` is the caller's project root (so relative paths resolve
 *       naturally), but the code can still read/write anywhere the host user
 *       can. Document this; do not imply isolation.
 *     - timeouts are enforced (default 30s, cap 300s) and kill the process
 *       GROUP so orphaned children cannot outlive a killed parent.
 *     - a runtime-injection env denylist strips known code-injection vectors
 *       (NODE_OPTIONS, LD_PRELOAD, BASH_ENV, …) from the inherited env.
 *     - `execute_file` additionally enforces a project-boundary check plus a
 *       deny-glob guard so it won't read paths outside cwd or sensitive
 *       patterns by default.
 *   For multi-tenant or untrusted input, this executor is NOT sufficient —
 *   wrap it in a real container/VM.
 */

import { spawn, execSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join, resolve, isAbsolute, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  detectRuntimes,
  buildCommand,
  SCRIPT_EXT,
  type RuntimeMap,
  type Language,
  type DetectDeps,
} from "./runtime.js";

const isWin = process.platform === "win32";

/** Result of a single execution. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True when the process was killed because `timeout` elapsed. */
  timedOut: boolean;
  /** True when the process was detached (background mode) at timeout. */
  backgrounded?: boolean;
  /** Command + runtime that were actually invoked (for diagnostics). */
  command?: string;
  /** Effective cwd the script ran in. */
  cwd?: string;
}

export interface ExecuteOptions {
  language: Language;
  code: string;
  /** Max runtime in ms. Default 30_000; hard cap MAX_TIMEOUT_MS. */
  timeout?: number;
  /** Detach instead of kill on timeout. Process group is tracked + killable. */
  background?: boolean;
  /** Override cwd (default = projectRoot / process.cwd()). */
  cwd?: string;
}

export interface ExecuteFileOptions extends ExecuteOptions {
  /** Project-relative (or absolute) path of the file to load into a var. */
  path: string;
}

/**
 * Default + hard-cap timeout. The default (30s) is conservative on purpose —
 * most sandbox probes (print, parse, count) finish in <1s. The hard cap
 * (300s) bounds runaway builds/installs invoked from user code.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 300_000;

/** Combined stdout+stderr byte cap. Prevents `yes`/`/dev/urandom` OOMs. */
export const DEFAULT_HARD_CAP_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Paths that `execute_file` refuses to read by default. Mirrors context-mode's
 * deny-glob: secrets, credentials, host-private key material. Matched as a
 * case-insensitive substring of the absolute target path.
 */
const DENY_PATH_PATTERNS = [
  ".ssh/",
  ".aws/",
  ".gnupg/",
  "id_rsa",
  "id_ecdsa",
  "id_ed25519",
  ".env",
  ".npmrc",
  ".pypirc",
  "credentials",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  ".netrc",
];

/** Resolve a sandbox temp dir that is NOT under the project working tree. */
function sandboxTmpDir(): string {
  // Prefer the OS real temp dir; fall back to os.tmpdir() (may be overridden
  // by TMPDIR but still outside the project in practice).
  try {
    return mkdtempSync(join(tmpdir(), ".massa-th0th-exec-"));
  } catch {
    return mkdtempSync(join("/tmp", ".massa-th0th-exec-"));
  }
}

/** Best-effort recursive removal; never throws (OS reclaims %TEMP%). */
function cleanupTmpDir(tmpDir: string): void {
  try {
    rmSync(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: isWin ? 8 : 2,
      retryDelay: 100,
    });
  } catch {
    /* best-effort */
  }
}

/** Kill an entire process tree. Windows: taskkill /T; POSIX: kill the group. */
function killTree(proc: ReturnType<typeof spawn>): void {
  if (!proc.pid) return;
  if (isWin) {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "pipe" });
    } catch {
      /* already dead */
    }
  } else {
    try {
      process.kill(-proc.pid, "SIGKILL"); // negative pid = whole group
    } catch {
      /* already dead */
    }
  }
}

/**
 * Build a child env that strips known code-injection vectors. The denylist is
 * intentionally a focused subset of context-mode's larger list — every entry
 * here is a documented RCE vector (startup scripts, module-path injection,
 * dynamic-linker hijack, compiler substitution). Anything not on the list is
 * inherited as-is (the code runs as the host user regardless).
 */
function buildSafeEnv(tmpDir: string): Record<string, string> {
  const DENIED = new Set([
    // Shell startup / option injection
    "BASH_ENV",
    "ENV",
    "PROMPT_COMMAND",
    "ZDOTDIR",
    // Node module/option injection
    "NODE_OPTIONS",
    "NODE_PATH",
    // Python startup / stdlib override
    "PYTHONSTARTUP",
    "PYTHONHOME",
    "PYTHONPATH",
    // Ruby / Perl option + lib injection
    "RUBYOPT",
    "RUBYLIB",
    "PERL5OPT",
    "PERL5LIB",
    "PERLLIB",
    // Dynamic linker hijack (loads a .so/.dylib before all others)
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    // Compiler substitution
    "RUSTC",
    "RUSTC_WRAPPER",
    "CC",
    "CXX",
  ]);

  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined && !DENIED.has(key) && !key.startsWith("BASH_FUNC_")) {
      env[key] = val;
    }
  }
  env["TMPDIR"] = tmpDir;
  env["LANG"] = env["LANG"] ?? "en_US.UTF-8";
  env["PYTHONDONTWRITEBYTECODE"] = "1";
  env["PYTHONUNBUFFERED"] = "1";
  env["NO_COLOR"] = "1";
  return env;
}

export class PolyglotExecutor {
  #hardCapBytes: number;
  #projectRootResolver: () => string;
  #runtimes: RuntimeMap;
  #backgroundedPids = new Set<number>();
  #deps?: DetectDeps;

  constructor(opts?: {
    hardCapBytes?: number;
    projectRoot?: string | (() => string);
    runtimes?: RuntimeMap;
    deps?: DetectDeps;
  }) {
    this.#hardCapBytes = opts?.hardCapBytes ?? DEFAULT_HARD_CAP_BYTES;
    const pr = opts?.projectRoot;
    this.#projectRootResolver =
      typeof pr === "function" ? pr : typeof pr === "string" ? () => pr : () => process.cwd();
    this.#runtimes = opts?.runtimes ?? detectRuntimes(opts?.deps);
    this.#deps = opts?.deps;
  }

  get runtimes(): RuntimeMap {
    return { ...this.#runtimes };
  }

  get projectRoot(): string {
    return this.#projectRootResolver();
  }

  /**
   * Kill all backgrounded processes (SIGTERM the group). Call on shutdown to
   * prevent zombies / port conflicts.
   */
  cleanupBackgrounded(): void {
    for (const pid of this.#backgroundedPids) {
      try {
        process.kill(isWin ? pid : -pid, "SIGTERM");
      } catch {
        /* already dead */
      }
    }
    this.#backgroundedPids.clear();
  }

  /**
   * Run `code` in the chosen language's detected runtime.
   *
   * The script FILE lives in a sandbox tmpDir; the process CWD is the project
   * root (or `cwd` override) so repo-relative paths resolve naturally.
   */
  async execute(opts: ExecuteOptions): Promise<ExecResult> {
    const { language, code, background = false } = opts;
    const timeout = this.#clampTimeout(opts.timeout);

    const tmpDir = sandboxTmpDir();
    try {
      const filePath = this.#writeScript(tmpDir, code, language);
      const cmd = buildCommand(this.#runtimes, language, filePath);

      if (cmd[0] === "__rust_compile_run__") {
        return await this.#compileAndRunRust(filePath, tmpDir, timeout);
      }

      const cwd = opts.cwd ?? this.#projectRootResolver();
      const result = await this.#spawn(cmd, cwd, tmpDir, timeout, background);
      if (!result.backgrounded) cleanupTmpDir(tmpDir);
      return result;
    } catch (err) {
      cleanupTmpDir(tmpDir);
      throw err;
    }
  }

  /**
   * Read `path` into a sandboxed FILE_CONTENT var, then run `code` over it.
   * Enforces project-boundary containment + deny-glob before execution so a
   * stray path can't exfiltrate secrets by default.
   *
   * SYMLINK DEFENSE: the boundary + deny-glob checks run against the REALPATH
   * of both the target file and the project root. A symlink inside the project
   * root pointing to `/etc/passwd` or a non-deny-glob secrets file would
   * otherwise pass both checks (its link path is under root and may not match
   * a deny pattern), then `readFileSync` follows the symlink out of the
   * project. Resolving symlinks first closes this bypass. If the target does
   * not exist yet (realpathSync throws ENOENT), we fall back to the lexical
   * absolute path so a missing-file error surfaces from the read, not a
   * spurious "blocked" message.
   */
  async executeFile(opts: ExecuteFileOptions): Promise<ExecResult> {
    const { path: filePath, language, code } = opts;
    const root = this.#projectRootResolver();
    const absolutePath = resolve(root, filePath);

    // Resolve symlinks on BOTH the target and the root so a symlinked target
    // that escapes the (possibly symlinked) root is caught. realpathSync
    // resolves the FULL chain of links to the canonical filesystem path.
    let realPath: string;
    let realRoot: string;
    try {
      realPath = realpathSync(absolutePath);
    } catch {
      // Target doesn't exist (ENOENT) or is unreadable. Fall back to the
      // lexical absolute path so the caller gets a clear "file not found"
      // from the read attempt, not a misleading "blocked" error.
      realPath = absolutePath;
    }
    try {
      realRoot = realpathSync(root);
    } catch {
      realRoot = root;
    }

    // Boundary: the realpath MUST stay under the realpath root. Resolves
    // `../` traversal, absolute paths, AND symlink escapes alike.
    const rel = relative(realRoot, realPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      const err: ExecResult = {
        stdout: "",
        stderr: `Blocked: path "${filePath}" resolves outside the project root (${root}).`,
        exitCode: 1,
        timedOut: false,
      };
      return err;
    }

    // Deny-glob: refuse sensitive path patterns regardless of boundary. Check
    // BOTH the lexical absolute path (catches a link named `.env` that points
    // elsewhere) AND the realpath (catches a link pointing TO a secrets file).
    const lowerAbs = absolutePath.toLowerCase();
    const lowerReal = realPath.toLowerCase();
    if (
      DENY_PATH_PATTERNS.some((p) => lowerAbs.includes(p)) ||
      DENY_PATH_PATTERNS.some((p) => lowerReal.includes(p))
    ) {
      const err: ExecResult = {
        stdout: "",
        stderr: `Blocked: path "${filePath}" matches a deny-listed pattern (secrets/credentials).`,
        exitCode: 1,
        timedOut: false,
      };
      return err;
    }

    const wrappedCode = this.#wrapWithFileContent(absolutePath, language, code);
    return this.execute({ ...opts, code: wrappedCode });
  }

  #clampTimeout(timeout: number | undefined): number {
    if (timeout === undefined) return DEFAULT_TIMEOUT_MS;
    if (timeout <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(timeout, MAX_TIMEOUT_MS);
  }

  #writeScript(tmpDir: string, code: string, language: Language): string {
    let body = code;
    // Go: wrap in a main package if the user didn't provide one.
    if (language === "go" && !body.includes("package ")) {
      body = `package main\n\nimport "fmt"\n\nfunc main() {\n${body}\n}\n`;
    }
    // PHP: needs an opening tag.
    if (language === "php" && !body.trimStart().startsWith("<?")) {
      body = `<?php\n${body}`;
    }
    const fp = join(tmpDir, `script.${SCRIPT_EXT[language]}`);
    writeFileSync(fp, body, { encoding: "utf-8", mode: 0o700 });
    return fp;
  }

  async #compileAndRunRust(
    srcPath: string,
    cwd: string,
    timeout: number,
  ): Promise<ExecResult> {
    const binPath = srcPath.replace(/\.rs$/, isWin ? ".exe" : "");
    // Compile rustc with its own (smaller) timeout so a hung compile can't
    // consume the whole runtime budget.
    try {
      execFileSync("rustc", [srcPath, "-o", binPath], {
        cwd,
        timeout: Math.min(timeout, 60_000),
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? ((err as { stderr?: string }).stderr ?? err.message)
          : String(err);
      return {
        stdout: "",
        stderr: `Compilation failed:\n${message}`,
        exitCode: 1,
        timedOut: false,
      };
    }
    return this.#spawn([binPath], cwd, cwd, timeout, false);
  }

  #spawn(
    cmd: string[],
    cwd: string,
    sandboxTmpDir: string,
    timeout: number,
    background: boolean,
  ): Promise<ExecResult> {
    return new Promise((res) => {
      const proc = spawn(cmd[0], cmd.slice(1), {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: buildSafeEnv(sandboxTmpDir),
        // New process group on Unix so killTree() can kill all children.
        detached: !isWin,
        windowsHide: isWin,
      });

      let timedOut = false;
      let resolved = false;
      let capExceeded = false;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;

      const timer = setTimeout(() => {
        timedOut = true;
        if (background) {
          // Detach: return partial output, keep the process running but tracked.
          resolved = true;
          if (proc.pid) this.#backgroundedPids.add(proc.pid);
          proc.unref();
          // Drain streams to no-op so the pipe doesn't fill + block the child.
          proc.stdout?.removeAllListeners("data");
          proc.stdout?.on("data", () => {});
          proc.stderr?.removeAllListeners("data");
          proc.stderr?.on("data", () => {});
          res({
            stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
            stderr: Buffer.concat(stderrChunks).toString("utf-8"),
            exitCode: 0,
            timedOut: true,
            backgrounded: true,
            command: cmd.join(" "),
            cwd,
          });
        } else {
          killTree(proc);
        }
      }, timeout);

      proc.stdout?.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= this.#hardCapBytes) {
          stdoutChunks.push(chunk);
        } else if (!capExceeded) {
          capExceeded = true;
          killTree(proc);
        }
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= this.#hardCapBytes) {
          stderrChunks.push(chunk);
        } else if (!capExceeded) {
          capExceeded = true;
          killTree(proc);
        }
      });

      proc.on("close", (exitCode) => {
        clearTimeout(timer);
        if (resolved) return;
        let stderr = Buffer.concat(stderrChunks).toString("utf-8");
        if (capExceeded) {
          stderr += `\n[output capped at ${(this.#hardCapBytes / 1024 / 1024).toFixed(0)}MB — process killed]`;
        }
        res({
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr,
          exitCode: timedOut ? null : exitCode,
          timedOut,
          command: cmd.join(" "),
          cwd,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (resolved) return;
        res({
          stdout: "",
          stderr: err.message,
          exitCode: null,
          timedOut: false,
          command: cmd.join(" "),
          cwd,
        });
      });
    });
  }

  /**
   * Prepend a FILE_CONTENT bootstrap to user code, per language. The user code
   * then has `FILE_CONTENT` (the file's text) and `file_path` (its absolute
   * path) in scope.
   */
  #wrapWithFileContent(absolutePath: string, language: Language, code: string): string {
    const escaped = JSON.stringify(absolutePath);
    switch (language) {
      case "javascript":
      case "typescript":
        return `const FILE_CONTENT_PATH = ${escaped};\nconst file_path = FILE_CONTENT_PATH;\nconst FILE_CONTENT = require("fs").readFileSync(FILE_CONTENT_PATH, "utf-8");\n${code}`;
      case "python":
        return `FILE_CONTENT_PATH = ${escaped}\nfile_path = FILE_CONTENT_PATH\nwith open(FILE_CONTENT_PATH, "r", encoding="utf-8") as _f:\n    FILE_CONTENT = _f.read()\n${code}`;
      case "shell": {
        const sq = "'" + absolutePath.replace(/'/g, "'\\''") + "'";
        return `FILE_CONTENT_PATH=${sq}\nfile_path=${sq}\nFILE_CONTENT=$(cat ${sq})\n${code}`;
      }
      case "ruby":
        return `FILE_CONTENT_PATH = ${escaped}\nfile_path = FILE_CONTENT_PATH\nFILE_CONTENT = File.read(FILE_CONTENT_PATH, encoding: "utf-8")\n${code}`;
      case "go":
        return `package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nvar FILE_CONTENT_PATH = ${escaped}\nvar file_path = FILE_CONTENT_PATH\n\nfunc main() {\n\tb, _ := os.ReadFile(FILE_CONTENT_PATH)\n\tFILE_CONTENT := string(b)\n\t_ = FILE_CONTENT\n\t_ = fmt.Sprint()\n${code}\n}\n`;
      case "rust":
        return `use std::fs;\n\nfn main() {\n    let file_content_path = ${escaped};\n    let file_path = file_content_path;\n    let file_content = fs::read_to_string(file_content_path).unwrap();\n    let _ = file_content;\n${code}\n}\n`;
      case "php":
        return `<?php\n$FILE_CONTENT_PATH = ${escaped};\n$file_path = $FILE_CONTENT_PATH;\n$FILE_CONTENT = file_get_contents($FILE_CONTENT_PATH);\n${code}`;
      case "perl":
        return `my $FILE_CONTENT_PATH = ${escaped};\nmy $file_path = $FILE_CONTENT_PATH;\nopen(my $fh, '<:encoding(UTF-8)', $FILE_CONTENT_PATH) or die "Cannot open: $!";\nmy $FILE_CONTENT = do { local $/; <$fh> };\nclose($fh);\n${code}`;
      case "r":
        return `FILE_CONTENT_PATH <- ${escaped}\nfile_path <- FILE_CONTENT_PATH\nFILE_CONTENT <- readLines(FILE_CONTENT_PATH, warn=FALSE, encoding="UTF-8")\nFILE_CONTENT <- paste(FILE_CONTENT, collapse="\\n")\n${code}`;
    }
  }
}
