import { afterEach, describe, expect, test } from "bun:test";
import { validateApiStartup } from "../startup-config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Tools API PostgreSQL startup validation", () => {
  test("rejects missing, malformed, non-PostgreSQL, and database-less URLs", () => {
    delete process.env.MASSA_AI_DEDICATED;

    for (const value of [undefined, "", "not a url", "mysql://u:p@localhost/app", "postgresql://u:p@localhost/"]) {
      if (value === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = value;
      expect(() => validateApiStartup()).toThrow(/DATABASE_URL/);
    }
  });

  test("accepts PostgreSQL URLs with an explicit database", () => {
    delete process.env.MASSA_AI_DEDICATED;
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/massa_ai_test";
    expect(validateApiStartup()).toBe(process.env.DATABASE_URL);
  });
});
