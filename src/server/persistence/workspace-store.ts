import type {
	RuntimeBoardData,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
} from "../../core/api-contract";
import type { RuntimeWorkspaceContext, RuntimeWorkspaceIndexEntry } from "../../state/workspace-state";

export interface WorkspaceStore {
	loadWorkspaceContext: (cwd: string, options?: { autoCreateIfMissing?: boolean }) => Promise<RuntimeWorkspaceContext>;
	loadWorkspaceContextById: (workspaceId: string) => Promise<RuntimeWorkspaceContext | null>;
	listWorkspaceIndexEntries: () => Promise<RuntimeWorkspaceIndexEntry[]>;
	loadWorkspaceBoardById: (workspaceId: string) => Promise<RuntimeBoardData>;
	loadWorkspaceState: (cwd: string) => Promise<RuntimeWorkspaceStateResponse>;
	saveWorkspaceState: (
		cwd: string,
		payload: RuntimeWorkspaceStateSaveRequest,
	) => Promise<RuntimeWorkspaceStateResponse>;
	removeWorkspaceIndexEntry: (workspaceId: string) => Promise<boolean>;
	removeWorkspaceStateFiles: (workspaceId: string) => Promise<void>;
}
