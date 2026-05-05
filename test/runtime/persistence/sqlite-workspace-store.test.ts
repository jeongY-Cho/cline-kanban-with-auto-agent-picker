import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "../../utilities/temp-dir";

interface TestEnv {
	home: string;
	repoPath: string;
	cleanup: () => void;
}

function createGitWorkspace(): TestEnv {
	const homeDir = createTempDir("kanban-home-");
	const repoDir = createTempDir("kanban-repo-");
	writeFileSync(join(repoDir.path, "README.md"), "# test\n", "utf8");
	spawnSync("git", ["init", "-b", "main"], { cwd: repoDir.path, stdio: "ignore" });
	return {
		home: homeDir.path,
		repoPath: repoDir.path,
		cleanup: () => {
			homeDir.cleanup();
			repoDir.cleanup();
		},
	};
}

describe("sqlite persistence", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("persists and reloads workspace board state via SqliteWorkspaceStore", async () => {
		const env = createGitWorkspace();
		const oldHome = process.env.HOME;
		process.env.HOME = env.home;
		try {
			const { ensureSqliteSchema, db, schema } = await import("../../../src/server/db/client");
			const { createSqliteWorkspaceStore } = await import("../../../src/server/persistence/sqlite-workspace-store");
			ensureSqliteSchema();
			const store = createSqliteWorkspaceStore();
			const context = await store.loadWorkspaceContext(env.repoPath);
			const now = new Date();
			db.insert(schema.boardColumns)
				.values([
					{
						id: `${context.workspaceId}:backlog`,
						workspaceId: context.workspaceId,
						title: "Backlog",
						position: 0,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: `${context.workspaceId}:in_progress`,
						workspaceId: context.workspaceId,
						title: "In Progress",
						position: 1,
						createdAt: now,
						updatedAt: now,
					},
				])
				.run();
			db.insert(schema.cards)
				.values([
					{
						id: "task-b",
						workspaceId: context.workspaceId,
						columnId: `${context.workspaceId}:backlog`,
						title: "Task B",
						description: "Task B",
						status: "backlog",
						position: 0,
						metadataJson: JSON.stringify({ id: "task-b", prompt: "Task B" }),
						createdAt: now,
						updatedAt: now,
					},
					{
						id: "task-a",
						workspaceId: context.workspaceId,
						columnId: `${context.workspaceId}:backlog`,
						title: "Task A",
						description: "Task A",
						status: "backlog",
						position: 1,
						metadataJson: JSON.stringify({ id: "task-a", prompt: "Task A" }),
						createdAt: now,
						updatedAt: now,
					},
				])
				.run();
			const loaded = await store.loadWorkspaceBoardById(context.workspaceId);
			expect(loaded.columns.map((column) => column.id)).toEqual(["backlog", "in_progress"]);
			expect(loaded.columns[0]?.cards.map((card) => card.id)).toEqual(["task-b", "task-a"]);
			expect(loaded.columns[0]?.cards[0]?.prompt).toBe("Task B");
		} finally {
			process.env.HOME = oldHome;
			env.cleanup();
		}
	});

	it("preserves explicit column/card ordering when multiple IDs sort differently", async () => {
		const env = createGitWorkspace();
		const oldHome = process.env.HOME;
		process.env.HOME = env.home;
		try {
			const { ensureSqliteSchema, db, schema } = await import("../../../src/server/db/client");
			const { createSqliteWorkspaceStore } = await import("../../../src/server/persistence/sqlite-workspace-store");
			ensureSqliteSchema();
			const store = createSqliteWorkspaceStore();
			const context = await store.loadWorkspaceContext(env.repoPath);
			const now = new Date();
			db.insert(schema.boardColumns)
				.values([
					{
						id: `${context.workspaceId}:review`,
						workspaceId: context.workspaceId,
						title: "Review",
						position: 0,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: `${context.workspaceId}:backlog`,
						workspaceId: context.workspaceId,
						title: "Backlog",
						position: 1,
						createdAt: now,
						updatedAt: now,
					},
				])
				.run();
			db.insert(schema.cards)
				.values([
					{
						id: "card-z",
						workspaceId: context.workspaceId,
						columnId: `${context.workspaceId}:backlog`,
						title: "z",
						description: "",
						status: "backlog",
						position: 0,
						metadataJson: JSON.stringify({ id: "card-z" }),
						createdAt: now,
						updatedAt: now,
					},
					{
						id: "card-a",
						workspaceId: context.workspaceId,
						columnId: `${context.workspaceId}:backlog`,
						title: "a",
						description: "",
						status: "backlog",
						position: 1,
						metadataJson: JSON.stringify({ id: "card-a" }),
						createdAt: now,
						updatedAt: now,
					},
				])
				.run();
			const loaded = await store.loadWorkspaceBoardById(context.workspaceId);
			expect(loaded.columns.map((column) => column.id)).toEqual(["review", "backlog"]);
			expect(loaded.columns[1]?.cards.map((card) => card.id)).toEqual(["card-z", "card-a"]);
		} finally {
			process.env.HOME = oldHome;
			env.cleanup();
		}
	});

	it("runs legacy JSON migration idempotently and tolerates corrupt workspace JSON", async () => {
		const env = createGitWorkspace();
		const oldHome = process.env.HOME;
		process.env.HOME = env.home;
		try {
			const { ensureSqliteSchema, db, schema } = await import("../../../src/server/db/client");
			const { runLegacyJsonToSqliteMigration } = await import(
				"../../../src/server/persistence/legacy-json-to-sqlite-migration"
			);
			const { getWorkspacesRootPath } = await import("../../../src/state/workspace-state");
			ensureSqliteSchema();
			const root = getWorkspacesRootPath();
			mkdirSync(root, { recursive: true });
			const validId = "workspace-valid";
			const badId = "workspace-corrupt";
			mkdirSync(join(root, validId), { recursive: true });
			mkdirSync(join(root, badId), { recursive: true });
			writeFileSync(
				join(root, "index.json"),
				JSON.stringify({
					version: 1,
					entries: {
						[validId]: { workspaceId: validId, repoPath: env.repoPath },
						[badId]: { workspaceId: badId, repoPath: join(env.repoPath, "nested") },
					},
					repoPathToId: { [env.repoPath]: validId, [join(env.repoPath, "nested")]: badId },
				}),
			);
			writeFileSync(
				join(root, validId, "board.json"),
				JSON.stringify({ columns: [{ id: "backlog", title: "Backlog", cards: [] }], dependencies: [] }),
			);
			writeFileSync(join(root, validId, "sessions.json"), JSON.stringify({}));
			writeFileSync(join(root, validId, "meta.json"), JSON.stringify({ revision: 3, updatedAt: Date.now() }));
			writeFileSync(join(root, badId, "board.json"), "{ bad json");

			await runLegacyJsonToSqliteMigration(() => {});
			await runLegacyJsonToSqliteMigration(() => {});

			const migratedWorkspace = await db.query.workspaces.findFirst({ where: (t, { eq }) => eq(t.id, validId) });
			expect(migratedWorkspace?.repoPath).toBe(env.repoPath);
			const snapshots = await db.select().from(schema.workspaceSnapshots);
			expect(snapshots.length).toBe(1);
			const corruptWorkspace = await db.query.workspaces.findFirst({ where: (t, { eq }) => eq(t.id, badId) });
			expect(corruptWorkspace).toBeUndefined();
		} finally {
			process.env.HOME = oldHome;
			env.cleanup();
		}
	});
});
