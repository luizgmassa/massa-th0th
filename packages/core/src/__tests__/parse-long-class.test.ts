import { afterEach, expect, test } from "bun:test";
import { describeNative } from "./_helpers/native-skip.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ParseStage } from "../services/etl/stages/parse.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describeNative("ParseStage long blocks", () => {
  test("keeps a class spanning more than 500 lines as the caller of its edges", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "massa-ai-long-class-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "long-service.ts");
    const filler = Array.from({ length: 510 }, (_, i) => `  // filler ${i}`).join("\n");
    const content = [
      "export class LongService {",
      filler,
      "  run() {",
      "    return dependency();",
      "  }",
      "}",
      "export function dependency() { return 1; }",
    ].join("\n");
    await fs.writeFile(filePath, content, "utf-8");

    const [parsed] = await new ParseStage().run(
      {
        projectId: "long-class-test",
        projectPath: dir,
        jobId: "long-class-test-job",
        emit: () => {},
      },
      [{
        absolutePath: filePath,
        relativePath: "long-service.ts",
        mtime: 0,
        size: content.length,
        contentHash: "test",
        needsReparse: true,
      }],
    );

    const classSymbol = parsed.symbols.find((symbol) => symbol.name === "LongService");
    expect(classSymbol?.lineEnd).toBe(515);
    const call = parsed.rawEdges.find((edge) => edge.symbolName === "dependency");
    // AD-001: native spans select the tightest lexical caller.
    expect(call?.callerSymbol).toBe("run");
  });
});
