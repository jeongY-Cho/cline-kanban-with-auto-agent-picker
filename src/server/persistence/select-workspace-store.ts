import { createJsonWorkspaceStore } from "./json-workspace-store";
import { createSqliteWorkspaceStore } from "./sqlite-workspace-store";
import type { WorkspaceStore } from "./workspace-store";

export function createWorkspaceStoreFromEnv(): WorkspaceStore {
	const mode = process.env.KANBAN_WORKSPACE_STORE?.trim().toLowerCase();
	if (mode === "json") return createJsonWorkspaceStore();
	return createSqliteWorkspaceStore();
}
