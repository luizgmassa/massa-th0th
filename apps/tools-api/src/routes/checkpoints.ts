/**
 * Checkpoint Routes
 *
 * POST /api/v1/checkpoints/list    - List saved task checkpoints
 * POST /api/v1/checkpoints/create  - Create a task checkpoint
 * POST /api/v1/checkpoints/restore - Restore a task checkpoint
 *
 * Thin wrappers that delegate to the existing core checkpoint tools.
 * No new business logic.
 */

import {
  ListCheckpointsTool,
  CreateCheckpointTool,
  RestoreCheckpointTool,
} from "@massa-th0th/core";
import { logger } from "@massa-th0th/shared";
import { Elysia, t } from "elysia";

let listCheckpointsTool: ListCheckpointsTool | null = null;
let createCheckpointTool: CreateCheckpointTool | null = null;
let restoreCheckpointTool: RestoreCheckpointTool | null = null;

function getListCheckpointsTool(): ListCheckpointsTool {
  if (!listCheckpointsTool) {
    listCheckpointsTool = new ListCheckpointsTool();
  }
  return listCheckpointsTool;
}

function getCreateCheckpointTool(): CreateCheckpointTool {
  if (!createCheckpointTool) {
    createCheckpointTool = new CreateCheckpointTool();
  }
  return createCheckpointTool;
}

function getRestoreCheckpointTool(): RestoreCheckpointTool {
  if (!restoreCheckpointTool) {
    restoreCheckpointTool = new RestoreCheckpointTool();
  }
  return restoreCheckpointTool;
}

export const checkpointRoutes = new Elysia({ prefix: "/api/v1/checkpoints" })
  .post(
    "/list",
    async ({ body }) => {
      try {
        return await getListCheckpointsTool().handle(body);
      } catch (error) {
        logger.error("Failed to list checkpoints", error as Error);
        return {
          success: false,
          error: `Checkpoint service unavailable: ${(error as Error).message}`,
        };
      }
    },
    {
      body: t.Object({
        taskId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        checkpointType: t.Optional(
          t.Union([t.Literal("auto"), t.Literal("manual"), t.Literal("milestone")]),
        ),
        includeExpired: t.Optional(t.Boolean({ default: false })),
        limit: t.Optional(t.Number({ default: 10 })),
        format: t.Optional(
          t.Union([t.Literal("json"), t.Literal("toon")], { default: "toon" }),
        ),
      }),
      detail: {
        tags: ["checkpoint"],
        summary: "List checkpoints",
        description:
          "List saved task checkpoints with optional filters (task, project, type).",
      },
    },
  )
  .post(
    "/create",
    async ({ body }) => {
      try {
        return await getCreateCheckpointTool().handle(body);
      } catch (error) {
        logger.error("Failed to create checkpoint", error as Error);
        return {
          success: false,
          error: `Checkpoint service unavailable: ${(error as Error).message}`,
        };
      }
    },
    {
      body: t.Object({
        taskId: t.String({ description: "Unique identifier for the task" }),
        description: t.String({ description: "Human-readable description of the task" }),
        status: t.Optional(
          t.Union(
            [
              t.Literal("pending"),
              t.Literal("in_progress"),
              t.Literal("completed"),
              t.Literal("failed"),
              t.Literal("paused"),
            ],
            { default: "in_progress" },
          ),
        ),
        currentStep: t.Optional(t.String()),
        progressPercent: t.Optional(t.Number({ default: 0 })),
        totalSteps: t.Optional(t.Number({ default: 0 })),
        completedSteps: t.Optional(t.Number({ default: 0 })),
        checkpointType: t.Optional(
          t.Union([t.Literal("manual"), t.Literal("milestone")], { default: "manual" }),
        ),
        agentId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        memoryIds: t.Optional(t.Array(t.String())),
        fileChanges: t.Optional(t.Array(t.String())),
        decisions: t.Optional(t.Array(t.String())),
        learnings: t.Optional(t.Array(t.String())),
        nextAction: t.Optional(t.String()),
        pendingValidations: t.Optional(t.Array(t.String())),
        format: t.Optional(
          t.Union([t.Literal("json"), t.Literal("toon")], { default: "toon" }),
        ),
      }),
      detail: {
        tags: ["checkpoint"],
        summary: "Create checkpoint",
        description:
          "Create a checkpoint to save current task progress for later resumption.",
      },
    },
  )
  .post(
    "/restore",
    async ({ body }) => {
      try {
        return await getRestoreCheckpointTool().handle(body);
      } catch (error) {
        logger.error("Failed to restore checkpoint", error as Error);
        return {
          success: false,
          error: `Checkpoint service unavailable: ${(error as Error).message}`,
        };
      }
    },
    {
      body: t.Object({
        checkpointId: t.Optional(
          t.String({ description: "Checkpoint ID to restore" }),
        ),
        taskId: t.Optional(
          t.String({
            description: "Restore the latest checkpoint for this task",
          }),
        ),
        format: t.Optional(
          t.Union([t.Literal("json"), t.Literal("toon")], { default: "toon" }),
        ),
      }),
      detail: {
        tags: ["checkpoint"],
        summary: "Restore checkpoint",
        description:
          "Restore a saved checkpoint and return its state plus integrity checks.",
      },
    },
  );
