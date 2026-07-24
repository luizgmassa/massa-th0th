import {
  assertDedicatedDbAllowed,
  requirePostgresDatabaseUrl,
} from "@massa-ai/shared/config";

/** Validate the mandatory database contract before API services initialize. */
export function validateApiStartup(): string {
  assertDedicatedDbAllowed();
  return requirePostgresDatabaseUrl();
}
