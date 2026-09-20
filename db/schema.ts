import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const googleConnection = sqliteTable("google_connection", {
  id: text("id").primaryKey(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  folderId: text("folder_id").notNull(),
  connectedAt: integer("connected_at").notNull(),
});

export const uploadSession = sqliteTable("upload_session", {
  id: text("id").primaryKey(),
  uploaderName: text("uploader_name").notNull(),
  fileName: text("file_name").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull(),
  driveFileId: text("drive_file_id"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});
