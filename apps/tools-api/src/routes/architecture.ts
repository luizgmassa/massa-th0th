/**
 * Architecture Routes (Wave 5 FR-01 / FR-02)
 *
 * GET /api/v1/project/:id/architecture — architecture map with opt-in aspects.
 *
 * Mirrors the `get_architecture` MCP tool. Query params:
 *   - aspects: comma-separated opt-in aspects (only "cycles" today). Unknown
 *     values return a 400 teaching error listing valid values (Wave 4 N6).
 *   - centralityLimit: int (default 20, clamped 1..500)
 *   - format: "json" | "toon" (default json)
 *   - fields: comma-separated projection (dotted paths)
 */

import { GetArchitectureTool, VALID_ARCHITECTURE_ASPECTS } from "@massa-ai/core";
import { Elysia, t } from "elysia";

let getArchitectureTool: GetArchitectureTool | null = null;
function getGetArchitectureTool(): GetArchitectureTool {
  if (!getArchitectureTool) {
    getArchitectureTool = new GetArchitectureTool();
  }
  return getArchitectureTool;
}

function boundedInt(
  raw: string | string[] | undefined,
  def: number,
  min: number,
  max: number,
): number {
  if (raw == null) return def;
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s == null || s === "") return def;
  const n = Number(s);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function parseCsv(value: string | string[] | undefined): string[] | undefined {
  if (value == null) return undefined;
  const s = Array.isArray(value) ? value.join(",") : value;
  if (!s) return undefined;
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export const architectureRoutes = new Elysia({ prefix: "/api/v1/project" })
  .get(
    "/:id/architecture",
    async ({ params, query }) => {
      const projectId = params.id;
      const aspects = parseCsv(query.aspects as string | string[] | undefined);
      const centralityLimit = boundedInt(
        query.centralityLimit as string | string[] | undefined,
        20,
        1,
        500,
      );
      const format = ((Array.isArray(query.format) ? query.format[0] : query.format) ??
        "json") as "json" | "toon";
      const fields = parseCsv(query.fields as string | string[] | undefined);

      return await getGetArchitectureTool().handle({
        projectId,
        aspects,
        centralityLimit,
        format,
        fields,
      });
    },
    {
      detail: {
        tags: ["architecture"],
        summary: "Get architecture map (Wave 5)",
        description:
          "Returns the architecture map: packages, entry points, routes, hotspots, communities, layers. Pass ?aspects=cycles to surface strongly connected components (Tarjan SCC over CALL edges). Unknown aspect values return a 400 teaching error.",
      },
    },
  )
  .get(
    "/architecture/_aspects",
    async () => {
      return {
        success: true,
        data: { aspects: VALID_ARCHITECTURE_ASPECTS },
      };
    },
    {
      detail: {
        tags: ["architecture"],
        summary: "List valid architecture aspects",
        description: "Returns the list of valid opt-in aspect names for get_architecture.",
      },
    },
  );