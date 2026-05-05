import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable(
	"workspaces",
	{
		id: text("id").primaryKey(),
		repoPath: text("repo_path").notNull(),
		name: text("name"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [uniqueIndex("workspaces_repo_path_unique").on(table.repoPath)],
);

export const boardColumns = sqliteTable(
	"board_columns",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		position: integer("position").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("board_columns_workspace_position_idx").on(table.workspaceId, table.position)],
);

export const cards = sqliteTable(
	"cards",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		columnId: text("column_id")
			.notNull()
			.references(() => boardColumns.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description"),
		status: text("status").notNull(),
		position: integer("position").notNull(),
		metadataJson: text("metadata_json"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		index("cards_workspace_column_position_idx").on(table.workspaceId, table.columnId, table.position),
		index("cards_workspace_status_idx").on(table.workspaceId, table.status),
	],
);

export const workspaceSnapshots = sqliteTable(
	"workspace_snapshots",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull(),
		snapshotJson: text("snapshot_json").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		uniqueIndex("workspace_snapshots_workspace_revision_unique").on(table.workspaceId, table.revision),
		index("workspace_snapshots_workspace_idx").on(table.workspaceId),
	],
);
