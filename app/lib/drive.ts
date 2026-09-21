import { env } from "cloudflare:workers";

const textEncoder = new TextEncoder();
const MAX_FILE_SIZE = 100 * 1024 * 1024 * 1024;

type GoogleConnection = {
  encrypted_refresh_token: string;
  folder_id: string;
};

type DriveFile = {
  id?: string;
};

type DriveFileList = {
  files?: DriveFile[];
};

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function required(name: keyof Cloudflare.Env) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("이 업로드 페이지의 Google Drive 연결이 아직 준비되지 않았습니다.");
  }
  return value;
}

function archiveFolderId() {
  const folderId = required("GOOGLE_ARCHIVE_FOLDER_ID").trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
    throw new Error("기록물 보관함 폴더 설정이 올바르지 않습니다.");
  }
  return folderId;
}

export function isUploadCodeValid(candidate: unknown) {
  if (typeof candidate !== "string") return false;
  const expected = env.UPLOAD_ACCESS_CODE;
  if (!expected || candidate.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
  }
  return difference === 0;
}

export function safeName(value: unknown, fallback: string, limit: number) {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f<>:"\/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, limit);
}

export function validFileSize(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_FILE_SIZE;
}

async function encryptionKey() {
  const raw = base64UrlDecode(required("TOKEN_ENCRYPTION_KEY"));
  if (raw.byteLength !== 32) throw new Error("저장소 암호화 설정이 올바르지 않습니다.");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    textEncoder.encode(value),
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(cipher))}`;
}

async function decrypt(value: string) {
  const [encodedIv, encodedCipher] = value.split(".");
  if (!encodedIv || !encodedCipher) throw new Error("저장된 Drive 연결을 읽을 수 없습니다.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlDecode(encodedIv) },
    await encryptionKey(),
    base64UrlDecode(encodedCipher),
  );
  return new TextDecoder().decode(plain);
}

async function connection(): Promise<GoogleConnection | null> {
  if (!env.DB) throw new Error("업로드 저장소를 사용할 수 없습니다.");
  return env.DB
    .prepare("SELECT encrypted_refresh_token, folder_id FROM google_connection WHERE id = ?")
    .bind("primary")
    .first<GoogleConnection>();
}

async function getGoogleAccessToken() {
  const stored = await connection();
  if (!stored) throw new Error("보관함이 아직 연결되지 않았습니다. 담당자에게 알려 주세요.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("GOOGLE_CLIENT_ID"),
      client_secret: required("GOOGLE_CLIENT_SECRET"),
      refresh_token: await decrypt(stored.encrypted_refresh_token),
      grant_type: "refresh_token",
    }),
  });
  const data = (await response.json().catch(() => null)) as { access_token?: string } | null;
  if (!response.ok || !data?.access_token) {
    throw new Error("Drive 보관함에 연결할 수 없습니다. 담당자에게 알려 주세요.");
  }

  return { accessToken: data.access_token, folderId: stored.folder_id };
}

async function driveJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !data) throw new Error("Google Drive 요청을 완료하지 못했습니다.");
  return data;
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function uploaderFolder(accessToken: string, archiveFolderId: string, uploaderName: string) {
  const query = [
    `'${escapeDriveQuery(archiveFolderId)}' in parents`,
    `name = '${escapeDriveQuery(uploaderName)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");
  const parameters = new URLSearchParams({
    q: query,
    spaces: "drive",
    pageSize: "1",
    fields: "files(id)",
  });
  const existing = await driveJson<DriveFileList>(
    `https://www.googleapis.com/drive/v3/files?${parameters.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (existing.files?.[0]?.id) return existing.files[0].id;

  const folder = await driveJson<DriveFile>("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: uploaderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [archiveFolderId],
    }),
  });
  if (!folder.id) throw new Error("촬영자 폴더를 만들지 못했습니다.");
  return folder.id;
}

export async function connectGoogleDrive(code: string, redirectUri: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: required("GOOGLE_CLIENT_ID"),
      client_secret: required("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const token = (await response.json().catch(() => null)) as { access_token?: string; refresh_token?: string } | null;
  if (!response.ok || !token?.access_token || !token.refresh_token) {
    throw new Error("Google Drive 권한을 저장하지 못했습니다. 다시 연결해 주세요.");
  }

  // The archive folder is deliberately configured once in Cloudflare rather
  // than created during OAuth setup. Reauthorizing Google only refreshes the
  // credential and cannot replace the production archive with a new folder.
  const folderId = archiveFolderId();
  if (!env.DB) throw new Error("업로드 저장소를 사용할 수 없습니다.");
  await env.DB
    .prepare(
      "INSERT INTO google_connection (id, encrypted_refresh_token, folder_id, connected_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, folder_id = excluded.folder_id, connected_at = excluded.connected_at",
    )
    .bind("primary", await encrypt(token.refresh_token), folderId, Date.now())
    .run();
}

export async function beginDriveUpload(input: {
  uploaderName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const { accessToken, folderId } = await getGoogleAccessToken();
  const destinationFolderId = await uploaderFolder(accessToken, folderId, input.uploaderName);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.sizeBytes),
    },
    body: JSON.stringify({ name: input.originalName, parents: [destinationFolderId] }),
  });
  const sessionUrl = response.headers.get("Location");
  if (!response.ok || !sessionUrl?.startsWith("https://www.googleapis.com/upload/")) {
    throw new Error("파일 전송을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  const uploadId = crypto.randomUUID();
  if (!env.DB) throw new Error("업로드 저장소를 사용할 수 없습니다.");
  await env.DB
    .prepare(
      "INSERT INTO upload_session (id, uploader_name, file_name, size_bytes, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(uploadId, input.uploaderName, input.originalName, input.sizeBytes, "started", Date.now())
    .run();

  return { uploadId, sessionUrl };
}

export async function completeDriveUpload(uploadId: string, fileId: string | null) {
  if (!env.DB) throw new Error("업로드 저장소를 사용할 수 없습니다.");
  await env.DB
    .prepare("UPDATE upload_session SET status = ?, drive_file_id = ?, completed_at = ? WHERE id = ?")
    .bind("complete", fileId, Date.now(), uploadId)
    .run();
}

export async function archiveUrl() {
  const stored = await connection();
  if (!stored) return null;
  return `https://drive.google.com/drive/folders/${encodeURIComponent(stored.folder_id)}`;
}

export async function makeSetupState() {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const payload = `${timestamp}.${nonce}`;
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

export async function verifySetupState(value: string | null) {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [timestamp, nonce, signature] = parts;
  const issuedAt = Number(timestamp);
  if (!Number.isSafeInteger(issuedAt) || !nonce || Date.now() - issuedAt > 10 * 60 * 1000 || issuedAt > Date.now() + 30_000) return false;
  const expected = await sign(`${timestamp}.${nonce}`);
  return safeEqual(signature, expected);
}

export function isSetupTokenValid(value: string | null) {
  return typeof value === "string" && safeEqual(value, env.ADMIN_SETUP_TOKEN ?? "");
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(required("ADMIN_SETUP_TOKEN")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value))));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length || a.length === 0) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export function googleClientId() {
  return required("GOOGLE_CLIENT_ID");
}
