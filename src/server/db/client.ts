import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getRuntimeHomePath } from "../../state/workspace-state";
import * as schema from "./schema";

const dbPath = join(getRuntimeHomePath(), "kanban.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

let sqliteSchemaEnsured = false;

export function ensureSqliteSchema(): void {
	if (sqliteSchemaEnsured) return;
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS workspaces (
			id TEXT PRIMARY KEY NOT NULL,
			repo_path TEXT NOT NULL,
			name TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			version INTEGER NOT NULL DEFAULT 0
		);
		CREATE UNIQUE INDEX IF NOT EXISTS workspaces_repo_path_unique ON workspaces (repo_path);

		CREATE TABLE IF NOT EXISTS board_columns (
			id TEXT PRIMARY KEY NOT NULL,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			position INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			version INTEGER NOT NULL DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS board_columns_workspace_position_idx ON board_columns (workspace_id, position);

		CREATE TABLE IF NOT EXISTS cards (
			id TEXT PRIMARY KEY NOT NULL,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			column_id TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			description TEXT,
			status TEXT NOT NULL,
			position INTEGER NOT NULL,
			metadata_json TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			version INTEGER NOT NULL DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS cards_workspace_column_position_idx ON cards (workspace_id, column_id, position);
		CREATE INDEX IF NOT EXISTS cards_workspace_status_idx ON cards (workspace_id, status);

		CREATE TABLE IF NOT EXISTS workspace_snapshots (
			id TEXT PRIMARY KEY NOT NULL,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			revision INTEGER NOT NULL,
			snapshot_json TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS workspace_snapshots_workspace_revision_unique ON workspace_snapshots (workspace_id, revision);
		CREATE INDEX IF NOT EXISTS workspace_snapshots_workspace_idx ON workspace_snapshots (workspace_id);
	`);

	sqliteSchemaEnsured = true;
}
export { schema };
