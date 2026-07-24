import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { OperationLogRepositoryPg } from "./operation-log-pg.js";

/** Backend-neutral entry point. PostgreSQL is mandatory. */
export function getOperationLogRepository(): OperationLogRepositoryPg {
  requirePostgresDatabaseUrl();
  return OperationLogRepositoryPg.getInstance();
}
