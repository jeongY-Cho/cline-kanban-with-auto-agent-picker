import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { runtimeBoardDataSchema, runtimeTaskSessionSummarySchema } from "../../core/api-contract";
import { getWorkspacesRootPath } from "../../state/workspace-state";
import { db, schema, sqlite } from "../db/client";

const LEGACY_INDEX_VERSION = 1;
const MIGRATION_KEY = "legacy_json_to_sqlite_v1";

const workspaceIndexEntrySchema = z.object({ workspaceId: z.string().min(1), repoPath: z.string().min(1) });
const workspaceIndexFileSchema = z.object({
	version: z.literal(LEGACY_INDEX_VERSION),
	entries: z.record(z.string(), workspaceIndexEntrySchema),
	repoPathToId: z.record(z.string(), z.string().min(1)),
});
const workspaceMetaSchema = z.object({ revision: z.number().int().nonnegative(), updatedAt: z.number() });
const workspaceSessionsSchema = z.record(z.string(), runtimeTaskSessionSummarySchema);

async function readJson(path: string): Promise<unknown | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: unknown }).code === "ENOENT"
		) {
			return null;
		}
		throw error;
	}
}

async function backupLegacyFile(path: string): Promise<void> {
	const backupPath = `${path}.bak`;
	try {
		await copyFile(path, backupPath);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error) {
			const code = (error as { code?: unknown }).code;
			if (code === "ENOENT" || code === "EEXIST") {
				return;
			}
		}
		throw error;
	}
}

export async function runLegacyJsonToSqliteMigration(log: (message: string) => void = console.info): Promise<void> {
	sqlite.exec(
		"CREATE TABLE IF NOT EXISTS migration_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
	);
	const prior = sqlite.prepare("SELECT value FROM migration_metadata WHERE key = ?").get(MIGRATION_KEY) as
		| { value: string }
		| undefined;
	if (prior?.value === "done") return;

	const workspacesRoot = getWorkspacesRootPath();
	const indexPath = join(workspacesRoot, "index.json");
	const indexRaw = await readJson(indexPath);
	if (indexRaw === null) {
		sqlite
			.prepare("INSERT OR REPLACE INTO migration_metadata (key, value, updated_at) VALUES (?, ?, ?)")
			.run(MIGRATION_KEY, "done", Date.now());
		return;
	}

	const parsedIndex = workspaceIndexFileSchema.safeParse(indexRaw);
	if (!parsedIndex.success) {
		log(`[kanban] JSON->SQLite migration failed: invalid workspace index at ${indexPath}.`);
		return;
	}

	const migrated: string[] = [];
	const skipped: string[] = [];
	const failed: string[] = [];

	for (const entry of Object.values(parsedIndex.data.entries)) {
		const workspaceId = entry.workspaceId;
		const workspaceDir = join(workspacesRoot, workspaceId);
		const boardPath = join(workspaceDir, "board.json");
		const sessionsPath = join(workspaceDir, "sessions.json");
		const metaPath = join(workspaceDir, "meta.json");
		try {
			const [boardRaw, sessionsRaw, metaRaw] = await Promise.all([
				readJson(boardPath),
				readJson(sessionsPath),
				readJson(metaPath),
			]);
			if (boardRaw === null) {
				skipped.push(workspaceId);
				continue;
			}
			const board = runtimeBoardDataSchema.parse(boardRaw);
			const sessions = workspaceSessionsSchema.parse(sessionsRaw ?? {});
			const meta = workspaceMetaSchema.parse(metaRaw ?? { revision: 0, updatedAt: 0 });
			const now = new Date(meta.updatedAt || Date.now());

			await db.transaction(async (tx) => {
				await tx
					.insert(schema.workspaces)
					.values({ id: workspaceId, repoPath: entry.repoPath, name: null, createdAt: now, updatedAt: now })
					.onConflictDoUpdate({ target: schema.workspaces.id, set: { repoPath: entry.repoPath, updatedAt: now } });
				await tx.delete(schema.cards).where(eq(schema.cards.workspaceId, workspaceId));
				await tx.delete(schema.boardColumns).where(eq(schema.boardColumns.workspaceId, workspaceId));

				for (const [columnIndex, column] of board.columns.entries()) {
					const columnDbId = `${workspaceId}:${column.id}`;
					await tx.insert(schema.boardColumns).values({
						id: columnDbId,
						workspaceId,
						title: column.title,
						position: columnIndex,
						createdAt: now,
						updatedAt: now,
					});
					for (const [cardIndex, card] of column.cards.entries()) {
						await tx.insert(schema.cards).values({
							id: card.id,
							workspaceId,
							columnId: columnDbId,
							title: card.title,
							description: null,
							status: column.id,
							position: cardIndex,
							metadataJson: null,
							createdAt: new Date(card.createdAt),
							updatedAt: new Date(card.updatedAt),
						});
					}
				}

				await tx
					.insert(schema.workspaceSnapshots)
					.values({
						id: `${workspaceId}:${meta.revision}`,
						workspaceId,
						revision: meta.revision,
						snapshotJson: JSON.stringify({ board, sessions }),
						createdAt: now,
					})
					.onConflictDoUpdate({
						target: [schema.workspaceSnapshots.workspaceId, schema.workspaceSnapshots.revision],
						set: { snapshotJson: JSON.stringify({ board, sessions }), createdAt: now },
					});
			});
			await Promise.all([backupLegacyFile(boardPath), backupLegacyFile(sessionsPath), backupLegacyFile(metaPath)]);
			migrated.push(workspaceId);
		} catch (error) {
			failed.push(`${workspaceId}(${error instanceof Error ? error.message : String(error)})`);
		}
	}

	await backupLegacyFile(indexPath);
	sqlite
		.prepare("INSERT OR REPLACE INTO migration_metadata (key, value, updated_at) VALUES (?, ?, ?)")
		.run(MIGRATION_KEY, "done", Date.now());
	log(
		`[kanban] JSON->SQLite migration complete. migrated=${migrated.join(",") || "none"}; skipped=${skipped.join(",") || "none"}; failed=${failed.join(",") || "none"}`,
	);
}
