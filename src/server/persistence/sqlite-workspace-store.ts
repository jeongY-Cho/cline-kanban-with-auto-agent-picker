import { and, asc, eq } from "drizzle-orm";
import type {
	RuntimeBoardData,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateSaveRequest,
} from "../../core/api-contract";
import { runtimeWorkspaceStateSaveRequestSchema } from "../../core/api-contract";
import { loadWorkspaceContext, WorkspaceStateConflictError } from "../../state/workspace-state";
import { db, schema } from "../db/client";
import type { WorkspaceStore } from "./workspace-store";

function scopedColumnId(workspaceId: string, columnId: string): string {
	return `${workspaceId}:${columnId}`;
}

function unscopedColumnId(workspaceId: string, scopedId: string): string {
	const prefix = `${workspaceId}:`;
	return scopedId.startsWith(prefix) ? scopedId.slice(prefix.length) : scopedId;
}

export function createSqliteWorkspaceStore(): WorkspaceStore {
	return {
		loadWorkspaceContext: async (cwd, options) => {
			const context = await loadWorkspaceContext(cwd, options);
			const now = new Date();
			await db
				.insert(schema.workspaces)
				.values({
					id: context.workspaceId,
					repoPath: context.repoPath,
					name: null,
					createdAt: now,
					updatedAt: now,
					version: 0,
				})
				.onConflictDoUpdate({
					target: schema.workspaces.id,
					set: { repoPath: context.repoPath, updatedAt: now },
				})
				.run();
			return context;
		},
		loadWorkspaceContextById: async (workspaceId) => {
			const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) });
			if (!ws) return null;
			try {
				return await loadWorkspaceContext(ws.repoPath, { autoCreateIfMissing: false });
			} catch {
				return null;
			}
		},
		listWorkspaceIndexEntries: async () =>
			await db
				.select({ workspaceId: schema.workspaces.id, repoPath: schema.workspaces.repoPath })
				.from(schema.workspaces)
				.orderBy(asc(schema.workspaces.repoPath)),
		loadWorkspaceBoardById: async (workspaceId) => {
			const cols = await db
				.select()
				.from(schema.boardColumns)
				.where(eq(schema.boardColumns.workspaceId, workspaceId))
				.orderBy(asc(schema.boardColumns.position), asc(schema.boardColumns.id));
			const cardRows = await db
				.select()
				.from(schema.cards)
				.where(eq(schema.cards.workspaceId, workspaceId))
				.orderBy(asc(schema.cards.position), asc(schema.cards.id));
			const cardsByCol = new Map<string, typeof cardRows>();
			for (const c of cardRows) {
				const arr = cardsByCol.get(c.columnId) ?? [];
				arr.push(c);
				cardsByCol.set(c.columnId, arr);
			}
			return {
				columns: cols.map((col) => ({
					id: unscopedColumnId(workspaceId, col.id) as RuntimeBoardData["columns"][number]["id"],
					title: col.title,
					cards: (cardsByCol.get(col.id) ?? []).map((card) => JSON.parse(card.metadataJson ?? "{}")),
				})),
				dependencies: [],
			};
		},
		loadWorkspaceState: async (cwd) => {
			const context = await loadWorkspaceContext(cwd, { autoCreateIfMissing: false });
			const board = await createSqliteWorkspaceStore().loadWorkspaceBoardById(context.workspaceId);
			const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, context.workspaceId) });
			const sessions = {} as Record<string, RuntimeTaskSessionSummary>;
			return {
				repoPath: context.repoPath,
				statePath: context.statePath,
				git: context.git,
				board,
				sessions,
				revision: ws?.version ?? 0,
			};
		},
		saveWorkspaceState: async (cwd, payload) => {
			const parsed = runtimeWorkspaceStateSaveRequestSchema.parse(payload) as RuntimeWorkspaceStateSaveRequest;
			const context = await loadWorkspaceContext(cwd);
			const now = new Date();
			const existing = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, context.workspaceId) });
			const currentRevision = existing?.version ?? 0;
			if (typeof parsed.expectedRevision === "number" && parsed.expectedRevision !== currentRevision)
				throw new WorkspaceStateConflictError(parsed.expectedRevision, currentRevision);
			await db.transaction(async (tx) => {
				if (!existing) {
					await tx.insert(schema.workspaces).values({
						id: context.workspaceId,
						repoPath: context.repoPath,
						name: null,
						createdAt: now,
						updatedAt: now,
						version: 1,
					});
				} else {
					const next = currentRevision + 1;
					const updated = await tx
						.update(schema.workspaces)
						.set({ updatedAt: now, version: next })
						.where(
							and(eq(schema.workspaces.id, context.workspaceId), eq(schema.workspaces.version, currentRevision)),
						);
					if (updated.changes === 0) throw new WorkspaceStateConflictError(currentRevision, currentRevision);
				}
				await tx.delete(schema.cards).where(eq(schema.cards.workspaceId, context.workspaceId));
				await tx.delete(schema.boardColumns).where(eq(schema.boardColumns.workspaceId, context.workspaceId));
				for (const [i, col] of parsed.board.columns.entries()) {
					await tx.insert(schema.boardColumns).values({
						id: scopedColumnId(context.workspaceId, col.id),
						workspaceId: context.workspaceId,
						title: col.title,
						position: i,
						createdAt: now,
						updatedAt: now,
					});
					for (const [j, card] of col.cards.entries()) {
						await tx.insert(schema.cards).values({
							id: card.id,
							workspaceId: context.workspaceId,
							columnId: scopedColumnId(context.workspaceId, col.id),
							title: card.title ?? "",
							description: card.prompt,
							status: col.id,
							position: j,
							metadataJson: JSON.stringify(card),
							createdAt: now,
							updatedAt: now,
						});
					}
				}
			});
			const persisted = await db.query.workspaces.findFirst({
				where: eq(schema.workspaces.id, context.workspaceId),
			});
			return {
				repoPath: context.repoPath,
				statePath: context.statePath,
				git: context.git,
				board: parsed.board,
				sessions: parsed.sessions,
				revision: persisted?.version ?? 1,
			};
		},
		removeWorkspaceIndexEntry: async (workspaceId) =>
			(await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).run()).changes > 0,
		removeWorkspaceStateFiles: async () => {},
	};
}
