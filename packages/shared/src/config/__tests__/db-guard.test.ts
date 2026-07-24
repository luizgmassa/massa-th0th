import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  SHARED_DB_NAME,
  getDbName,
  isSharedDb,
  assertDedicatedDbAllowed,
  requirePostgresDatabaseUrl,
} from "../db-guard";
import { parsePositiveIntEnv } from "../int-env";

const SHARED_URL = "postgresql://massa_ai:x@localhost:5432/massa_ai";
const ISOLATED_URL = "postgresql://massa_ai:x@localhost:5432/massa_ai_dedicated";

describe("getDbName / isSharedDb", () => {
  test("extracts lowercased last path segment, query stripped", () => {
    expect(getDbName("postgresql://u:p@h:5432/massa_ai")).toBe("massa_ai");
    expect(getDbName("postgresql://u:p@h:5432/Massa_Th0th?sslmode=require")).toBe(
      "massa_ai",
    );
    expect(getDbName("postgresql://u:p@h:5432/massa_ai_dedicated")).toBe(
      "massa_ai_dedicated",
    );
    expect(getDbName(undefined)).toBeNull();
    expect(getDbName("not a url")).toBeNull();
    expect(getDbName("postgresql://u:p@h:5432/")).toBeNull();
  });

  test("isSharedDb matches only the shared name", () => {
    expect(isSharedDb(SHARED_URL)).toBe(true);
    expect(isSharedDb(ISOLATED_URL)).toBe(false);
    expect(isSharedDb(undefined)).toBe(false);
    expect(isSharedDb(SHARED_DB_NAME)).toBe(false); // not a URL form
  });
});

describe("requirePostgresDatabaseUrl", () => {
  test("accepts postgres and postgresql URLs with a database name", () => {
    expect(requirePostgresDatabaseUrl("postgres://u:p@localhost:5432/app")).toBe(
      "postgres://u:p@localhost:5432/app",
    );
    expect(requirePostgresDatabaseUrl(ISOLATED_URL)).toBe(ISOLATED_URL);
  });

  test("rejects missing, malformed, non-PostgreSQL, and database-less URLs", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(() => requirePostgresDatabaseUrl()).toThrow(/DATABASE_URL/);
    process.env.DATABASE_URL = original;

    for (const value of ["", "not a url", "mysql://u:p@localhost/app", "postgresql://u:p@localhost/"]) {
      expect(() => requirePostgresDatabaseUrl(value)).toThrow(/DATABASE_URL/);
    }
  });
});

describe("assertDedicatedDbAllowed — dedicated-vector guard", () => {
  const ORIG = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIG };
  });

  afterEach(() => {
    process.env = { ...ORIG };
  });

  test("inert (no throw) when MASSA_AI_DEDICATED is unset", () => {
    delete process.env.MASSA_AI_DEDICATED;
    process.env.DATABASE_URL = SHARED_URL;
    expect(() => assertDedicatedDbAllowed()).not.toThrow();
  });

  test("throws when DEDICATED=1 + shared DATABASE_URL (vector unset)", () => {
    process.env.MASSA_AI_DEDICATED = "1";
    process.env.DATABASE_URL = SHARED_URL;
    expect(() => assertDedicatedDbAllowed()).toThrow(/refuses to bind the shared DB/);
  });

  test("no throw when DEDICATED=1 + isolated DATABASE_URL", () => {
    process.env.MASSA_AI_DEDICATED = "1";
    process.env.DATABASE_URL = ISOLATED_URL;
    expect(() => assertDedicatedDbAllowed()).not.toThrow();
  });
});

describe("parsePositiveIntEnv", () => {
  test("returns default for unset / empty / garbage / negative", () => {
    expect(parsePositiveIntEnv(undefined, 300_000)).toBe(300_000);
    expect(parsePositiveIntEnv("", 300_000)).toBe(300_000);
    expect(parsePositiveIntEnv("garbage", 300_000)).toBe(300_000);
    expect(parsePositiveIntEnv("-5", 300_000)).toBe(300_000);
    expect(parsePositiveIntEnv("NaN", 300_000)).toBe(300_000);
    expect(parsePositiveIntEnv("1.5", 300_000)).toBe(300_000); // non-integer
  });

  test("floors 0 to default by default (sane floor for reaper knobs)", () => {
    expect(parsePositiveIntEnv("0", 300_000)).toBe(300_000);
    expect(parsePositiveIntEnv("0", 60_000)).toBe(60_000);
  });

  test("honors explicit 0 with allowZero (proxy disable timeout)", () => {
    expect(parsePositiveIntEnv("0", 120000, { allowZero: true })).toBe(0);
    expect(parsePositiveIntEnv("0", 120000, { allowZero: true })).toBe(0);
    // garbage / negative still fall back even with allowZero
    expect(parsePositiveIntEnv("garbage", 120000, { allowZero: true })).toBe(120000);
    expect(parsePositiveIntEnv("-1", 120000, { allowZero: true })).toBe(120000);
  });

  test("honors valid positive integers", () => {
    expect(parsePositiveIntEnv("1000", 300_000)).toBe(1000);
    expect(parsePositiveIntEnv("999999", 60_000)).toBe(999999);
    expect(parsePositiveIntEnv("5", 120000, { allowZero: true })).toBe(5);
  });
});
