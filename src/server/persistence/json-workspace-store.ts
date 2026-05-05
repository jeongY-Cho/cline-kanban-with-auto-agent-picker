import {
	listWorkspaceIndexEntries,
	loadWorkspaceBoardById,
	loadWorkspaceContext,
	loadWorkspaceContextById,
	loadWorkspaceState,
	removeWorkspaceIndexEntry,
	removeWorkspaceStateFiles,
	saveWorkspaceState,
} from "../../state/workspace-state";
import type { WorkspaceStore } from "./workspace-store";

export function createJsonWorkspaceStore(): WorkspaceStore {
	return {
		loadWorkspaceContext,
		loadWorkspaceContextById,
		listWorkspaceIndexEntries,
		loadWorkspaceBoardById,
		loadWorkspaceState,
		saveWorkspaceState,
		removeWorkspaceIndexEntry,
		removeWorkspaceStateFiles,
	};
}
