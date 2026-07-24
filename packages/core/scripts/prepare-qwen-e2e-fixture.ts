import path from "node:path";
import { buildQwenFixture } from "../src/__tests__/e2e/qwen-fixture.js";

const explicitPath = process.env.MASSA_AI_E2E_PROJECT_PATH?.trim();
if (process.env.MASSA_AI_DEDICATED !== "1" || !explicitPath) {
  console.log(
    "[qwen-fixture] skipped: requires MASSA_AI_DEDICATED=1 and explicit MASSA_AI_E2E_PROJECT_PATH",
  );
  process.exit(0);
}

const sourceRoot = path.resolve(import.meta.dir, "../../..");
const fixture = await buildQwenFixture({
  sourceRoot,
  destination: path.resolve(explicitPath),
});
console.log(
  `[qwen-fixture] ready head=${fixture.head} files=${fixture.files.length} path=${fixture.destination}`,
);
