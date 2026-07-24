import type { ParserReadinessSnapshot } from "@massa-ai/core/services";

export interface ToolsApiHealthResponse {
  status: "ok";
  service: "massa-ai-tools-api";
  version: "1.0.0";
  timestamp: string;
  parser: ParserReadinessSnapshot;
}

/** Liveness is always `ok`; parser readiness is an additive indexing signal. */
export function buildHealthResponse(
  parser: ParserReadinessSnapshot,
  now: Date = new Date(),
): ToolsApiHealthResponse {
  return {
    status: "ok",
    service: "massa-ai-tools-api",
    version: "1.0.0",
    timestamp: now.toISOString(),
    parser,
  };
}

export async function listenAfterParserValidation(options: {
  validate: () => Promise<unknown>;
  listen: () => void;
  onValidationFailure: (error: unknown) => void;
}): Promise<void> {
  try {
    await options.validate();
  } catch (error) {
    options.onValidationFailure(error);
  }
  options.listen();
}
