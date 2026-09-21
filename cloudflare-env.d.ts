declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_ARCHIVE_FOLDER_ID?: string;
    UPLOAD_ACCESS_CODE?: string;
    ADMIN_SETUP_TOKEN?: string;
    TOKEN_ENCRYPTION_KEY?: string;
  }
}
