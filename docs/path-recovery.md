# Path Recovery — Re-associating an Index After a Directory Rename

## The Problem

When you rename a project directory on disk, the massa-ai index still
references the old path. The `Workspace.projectPath` column stores the
filesystem path at indexing time. After a rename:

- The `projectId` is unchanged (it's a stable identifier, not a path).
- The `projectPath` is stale (points to the old directory name).
- New indexing operations fail (the path no longer exists).
- Search and retrieval still work (they use `projectId`, not the path), but
  re-indexing and incremental updates are broken.

## The Solution: `--recover`

The `massa-ai-config recover` command re-associates an existing index with
a new filesystem path. It does NOT re-index — it updates the `projectPath`
column so future indexing operations target the new directory.

### Usage

```bash
massa-ai-config recover <projectId> --path <newPath>
```

### Example

```bash
# Before: project was indexed at /home/user/old-project-name
# After: directory renamed to /home/user/new-project-name

massa-ai-config recover my-project --path /home/user/new-project-name
```

### How It Works

1. The command looks up the `projectId` in the `Workspace` table.
2. If the project exists, it updates `projectPath` to the new path.
3. If the project doesn't exist, it returns a not-found error.
4. The alias-chain (M16/M17) is preserved — the `projectId` doesn't change,
   only the `projectPath`.

### Alias-Chain (M16/M17)

The alias-chain is the project-identity resolution system: when a project is
renamed (via the rename API), the old `projectId` becomes an alias pointing
to the new `projectId`. The `ProjectIdentityAliasResolver` flattens these
chains at write-time so writes to a retired ID reach the canonical ID.

`--recover` does NOT use the alias-chain for resolution — it operates on the
`projectPath` column directly. The alias-chain is for `projectId` resolution;
`--recover` is for `projectPath` re-association after a filesystem rename.

### Error Handling

- **Non-existent projectId**: returns an error with "not found" — the project
  must be indexed before it can be recovered.
- **Missing `--path`**: returns a usage error.
- **Database unavailable**: returns a connection error.

## When to Use `--recover` vs. the Rename API

| Scenario | Use |
|----------|-----|
| Directory renamed on disk, `projectId` unchanged | `--recover` |
| Project renamed in massa-ai (projectId changes, alias chain created) | Rename API (`/api/v1/project/rename`) |
| Merging two projects into one | Merge API (`/api/v1/project/merge`) |

`--recover` is for filesystem-level path changes. The Rename/Merge APIs are
for identity-level changes (when you want a new `projectId`).