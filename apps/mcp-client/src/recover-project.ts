/**
 * N42 — Path recovery: re-associate a project index with a new filesystem path.
 *
 * Used by the `massa-th0th-config recover <projectId> --path <newPath>` CLI
 * command. Updates the `Workspace.projectPath` column without re-indexing.
 * The alias-chain (M16/M17) is preserved — the `projectId` doesn't change,
 * only the `projectPath`.
 */

import { getPrismaClient } from "@massa-th0th/core/services";

export interface RecoverResult {
  found: boolean;
  oldPath: string | null;
  newPath: string;
}

/**
 * Re-associate a project's index with a new filesystem path.
 *
 * @param projectId - The project ID to recover (must exist in Workspace table)
 * @param newPath - The new filesystem path
 * @returns { found, oldPath, newPath } — if found=false, the project doesn't exist
 */
export async function recoverProjectPath(
  projectId: string,
  newPath: string,
): Promise<RecoverResult> {
  const prisma = getPrismaClient();

  const existing = await prisma.workspace.findUnique({
    where: { projectId },
    select: { projectPath: true },
  });

  if (!existing) {
    return { found: false, oldPath: null, newPath };
  }

  await prisma.workspace.update({
    where: { projectId },
    data: { projectPath: newPath },
  });

  return {
    found: true,
    oldPath: existing.projectPath,
    newPath,
  };
}