import { requirePostgresDatabaseUrl } from "@massa-th0th/shared/config";
import { GraphGenerationRepositoryPg } from "./graph-generation-repository-pg.js";

export function getGraphGenerationRepository(): GraphGenerationRepositoryPg {
  requirePostgresDatabaseUrl();
  return GraphGenerationRepositoryPg.getInstance();
}
