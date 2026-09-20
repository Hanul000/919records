"use client";

import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  FileVideo,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UploadCloud,
  WifiOff,
} from "lucide-react";

type UploadState = "waiting" | "uploading" | "complete" | "error";

type UploadItem = {
  id: string;
  file: File;
  fileHandle?: LocalFileHandle;
  state: UploadState;
  uploadedBytes: number;
  message?: string;
};

type UploadSession = {
  uploadId: string;
  sessionUrl: string;
};

type LocalFileHandle = {
  kind?: "file" | "directory";
  getFile: () => Promise<File>;
  queryPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
};

type ResumeRecord = {
  key: string;
  fileHandle: LocalFileHandle;
};

type ResumeSettings = {
  name: string;
  accessCode: string;
};

const CHUNK_SIZE = 32 * 1024 * 1024;
const SESSION_PREFIX = "919-upload-session:";
const RESUME_SETTINGS_KEY = "919-upload-settings";
const RESUME_DATABASE = "919-upload-resume";
const RESUME_STORE = "files";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function sessionKey(file: File) {
  return `${SESSION_PREFIX}${file.name}:${file.size}:${file.lastModified}`;
}

function readSession(file: File): UploadSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(file));
    return raw ? (JSON.parse(raw) as UploadSession) : null;
  } catch {
    return null;
  }
}

function saveSession(file: File, session: UploadSession) {
  try {
    sessionStorage.setItem(sessionKey(file), JSON.stringify(session));
  } catch {
    // The current transfer can continue even if this browser declines session storage.
  }
}

function clearSession(file: File) {
  try {
    sessionStorage.removeItem(sessionKey(file));
  } catch {
    // Nothing to clean up when session storage is unavailable.
  }
}

function openResumeDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(RESUME_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RESUME_STORE)) {
        request.result.createObjectStore(RESUME_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveFileHandle(file: File, fileHandle?: LocalFileHandle) {
  if (!fileHandle) return;
  const database = await openResumeDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RESUME_STORE, "readwrite");
      transaction
        .objectStore(RESUME_STORE)
        .put({ key: sessionKey(file), fileHandle } satisfies ResumeRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function deleteFileHandle(file: File) {
  const database = await openResumeDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RESUME_STORE, "readwrite");
      transaction.objectStore(RESUME_STORE).delete(sessionKey(file));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function readFileHandles() {
  const database = await openResumeDatabase();
  try {
    return await new Promise<ResumeRecord[]>((resolve, reject) => {
      const transaction = database.transaction(RESUME_STORE, "readonly");
      const request = transaction.objectStore(RESUME_STORE).getAll();
      request.onsuccess = () => resolve(request.result as ResumeRecord[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function saveResumeSettings(settings: ResumeSettings) {
  try {
    sessionStorage.setItem(RESUME_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The upload itself can still continue when session storage is unavailable.
  }
}

function readResumeSettings(): ResumeSettings | null {
  try {
    const raw = sessionStorage.getItem(RESUME_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as ResumeSettings) : null;
  } catch {
    return null;
  }
}

function clearResumeSettings() {
  try {
    sessionStorage.removeItem(RESUME_SETTINGS_KEY);
  } catch {
    // There is nothing else to clean up.
  }
}

async function serverJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !data) {
    const message =
      (data as { error?: string } | null)?.error ??
      "요청을 처리하지 못했습니다.";
    throw new Error(message);
  }
  return data;
}

async function receivedBytes(sessionUrl: string, size: number) {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${size}` },
  });

  if (response.status === 200 || response.status === 201) return size;
  if (response.status !== 308)
    throw new Error("업로드 상태를 확인하지 못했습니다.");

  const range = response.headers.get("Range");
  const match = range?.match(/bytes=0-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

async function sendFile(
  file: File,
  sessionUrl: string,
  onProgress: (bytes: number) => void,
) {
  let offset = await receivedBytes(sessionUrl, file.size);
  onProgress(offset);
  if (offset >= file.size) return {};

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    let response: Response | undefined;
    let recoveredProgress = false;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        response = await fetch(sessionUrl, {
          method: "PUT",
          headers: {
            "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
          },
          body: chunk,
        });
        break;
      } catch {
        try {
          const confirmedBytes = await receivedBytes(sessionUrl, file.size);
          if (confirmedBytes >= file.size) {
            onProgress(file.size);
            return {};
          }
          if (confirmedBytes > offset) {
            offset = confirmedBytes;
            onProgress(offset);
            recoveredProgress = true;
            break;
          }
        } catch {
          // The next retry below handles a temporary inability to inspect the upload session.
        }
        if (attempt === 3)
          throw new Error(
            "인터넷 연결이 복구되면 같은 파일을 다시 선택해 이어 올려 주세요.",
          );
        await new Promise((resolve) =>
          setTimeout(resolve, 1200 * (attempt + 1)),
        );
      }
    }

    if (recoveredProgress) continue;
    if (!response) throw new Error("업로드 연결을 만들지 못했습니다.");
    if (response.status === 200 || response.status === 201) {
      onProgress(file.size);
      return await response.json().catch(() => ({}));
    }

    if (response.status !== 308) {
      throw new Error(
        "Google Drive가 이 파일을 받지 못했습니다. 같은 파일을 다시 시도해 주세요.",
      );
    }

    offset = await receivedBytes(sessionUrl, file.size);
    onProgress(offset);
  }
}

export default function Home() {
  const [name, setName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resumeOnLoadRef = useRef(false);

  const totalBytes = useMemo(
    () => items.reduce((total, item) => total + item.file.size, 0),
    [items],
  );
  const completedBytes = useMemo(
    () => items.reduce((total, item) => total + item.uploadedBytes, 0),
    [items],
  );
  const overallProgress =
    totalBytes === 0 ? 0 : Math.round((completedBytes / totalBytes) * 100);
  const currentItem = useMemo(
    () => items.find((item) => item.state === "uploading") ?? null,
    [items],
  );
  const currentFileProgress =
    currentItem && currentItem.file.size > 0
      ? Math.round((currentItem.uploadedBytes / currentItem.file.size) * 100)
      : 0;
  const completedFileCount = useMemo(
    () => items.filter((item) => item.state === "complete").length,
    [items],
  );

  function addFiles(files: FileList | File[], fileHandles?: LocalFileHandle[]) {
    const incoming = Array.from(files)
      .map((file, index) => ({ file, fileHandle: fileHandles?.[index] }))
      .filter(({ file }) => file.size > 0);
    if (incoming.length === 0) return;

    setItems((current) => [
      ...current,
      ...incoming.map(({ file, fileHandle }) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        fileHandle,
        state: "waiting" as const,
        uploadedBytes: 0,
      })),
    ]);
    setNotice(null);
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  useEffect(() => {
    let mounted = true;

    async function restoreInterruptedUpload() {
      const settings = readResumeSettings();
      if (!settings) return;

      try {
        const records = await readFileHandles();
        const restored: UploadItem[] = [];

        for (const record of records) {
          const permission = record.fileHandle.queryPermission
            ? await record.fileHandle.queryPermission({ mode: "read" })
            : "granted";
          if (permission !== "granted") continue;

          const file = await record.fileHandle.getFile();
          if (sessionKey(file) !== record.key || !readSession(file)) continue;

          restored.push({
            id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
            file,
            fileHandle: record.fileHandle,
            state: "waiting",
            uploadedBytes: 0,
          });
        }

        if (!mounted || restored.length === 0) return;
        setName(settings.name);
        setAccessCode(settings.accessCode);
        setItems(restored);
        resumeOnLoadRef.current = true;
      } catch {
        if (mounted) {
          setNotice(
            "새로고침 전 업로드를 자동으로 다시 열지 못했습니다. 같은 파일을 다시 선택하면 이어서 올릴 수 있어요.",
          );
        }
      }
    }

    void restoreInterruptedUpload();
    return () => {
      mounted = false;
    };
  }, []);

  async function startUploads() {
    const uploaderName = name.trim();
    if (!uploaderName) {
      setNotice("이름을 먼저 입력해 주세요.");
      return;
    }
    if (!accessCode.trim()) {
      setNotice("전달받은 업로드 코드를 입력해 주세요.");
      return;
    }
    if (items.length === 0) {
      setNotice("올릴 원본 파일을 선택해 주세요.");
      return;
    }

    setIsSending(true);
    setNotice(null);
    saveResumeSettings({ name: uploaderName, accessCode });
    let hadError = false;

    for (const item of items) {
      if (item.state === "complete") continue;
      updateItem(item.id, { state: "uploading", message: "업로드 준비 중…" });

      try {
        let session = readSession(item.file);
        if (!session) {
          const initResponse = await fetch("/api/upload/initiate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessCode,
              uploaderName,
              originalName: item.file.name,
              mimeType: item.file.type || "application/octet-stream",
              sizeBytes: item.file.size,
            }),
          });
          const data = await serverJson<{
            uploadId: string;
            sessionUrl: string;
          }>(initResponse);
          session = { uploadId: data.uploadId, sessionUrl: data.sessionUrl };
          saveSession(item.file, session);
        }
        await saveFileHandle(item.file, item.fileHandle).catch(() => {
          // Unsupported browsers keep the existing same-file resume fallback.
        });

        updateItem(item.id, { message: "Drive로 전송 중…" });
        const driveFile = (await sendFile(
          item.file,
          session.sessionUrl,
          (uploadedBytes) => {
            updateItem(item.id, { uploadedBytes });
          },
        )) as { id?: string };

        await serverJson(
          await fetch("/api/upload/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessCode,
              uploadId: session.uploadId,
              fileId: driveFile.id ?? null,
            }),
          }),
        );

        clearSession(item.file);
        await deleteFileHandle(item.file).catch(() => {
          // A completed upload does not need the saved handle to be removed before continuing.
        });
        updateItem(item.id, {
          state: "complete",
          uploadedBytes: item.file.size,
          message: "Drive에 저장됨",
        });
      } catch (error) {
        hadError = true;
        const message =
          error instanceof Error
            ? error.message
            : "업로드를 완료하지 못했습니다.";
        updateItem(item.id, { state: "error", message });
      }
    }

    if (!hadError) clearResumeSettings();
    setIsSending(false);
  }

  useEffect(() => {
    if (!resumeOnLoadRef.current || isSending || items.length === 0) return;
    resumeOnLoadRef.current = false;
    void startUploads();
  }, [isSending, items]);

  async function chooseFiles() {
    type PickerWindow = Window & {
      showOpenFilePicker?: (options: {
        multiple: boolean;
      }) => Promise<LocalFileHandle[]>;
    };
    const picker = (window as PickerWindow).showOpenFilePicker;
    if (!picker) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const fileHandles = await picker({ multiple: true });
      const files = await Promise.all(
        fileHandles.map((fileHandle) => fileHandle.getFile()),
      );
      addFiles(files, fileHandles);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice("파일을 선택하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isSending) return;

    const droppedFiles = Array.from(event.dataTransfer.files);
    type DroppedItem = DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<LocalFileHandle | null>;
    };
    const droppedItems = Array.from(event.dataTransfer.items) as DroppedItem[];
    const fileHandles = await Promise.all(
      droppedItems.map(
        (item) => item.getAsFileSystemHandle?.() ?? Promise.resolve(null),
      ),
    );
    const usableHandles = fileHandles.filter(
      (fileHandle): fileHandle is LocalFileHandle =>
        fileHandle?.kind === "file",
    );

    addFiles(
      droppedFiles,
      usableHandles.length === droppedFiles.length ? usableHandles : undefined,
    );
  }

  return (
    <main
      className="min-h-screen bg-cover bg-center bg-fixed px-4 py-7 text-slate-950 sm:px-8 sm:py-12"
      style={{ backgroundImage: "url('/919-background.jpg')" }}
    >
      <div className="mx-auto max-w-[760px]">
        <header className="mb-9 flex items-center gap-3">
          <a
            href="/api/archive/open"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-none bg-[#db6f31] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#c75d28] focus:outline-none focus:ring-4 focus:ring-[#fbe8dc]"
          >
            <FolderOpen size={17} aria-hidden="true" /> 보관함 보기
          </a>
        </header>

        <section className="overflow-hidden rounded-none border-[3px] border-[#db6f31] bg-white/90 shadow-[0_10px_24px_rgba(46,27,16,0.18),0_30px_96px_rgba(46,27,16,0.42),0_48px_140px_rgba(46,27,16,0.18)]">
          <div className="border-b-4 border-[#db6f31] bg-white/75 px-6 py-8 text-[#32190e] sm:px-10">
            <p className="mb-2 text-sm font-semibold tracking-wide text-[#74300f]">
              원본 제출
            </p>
            <h1 className="text-3xl font-bold tracking-[-0.04em] text-[#db6f31] sm:text-4xl">
              기록물을 올려 주세요
            </h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-[#54301d]">
              파일은 촬영자의 Drive가 아니라 919-최종-업로드 안의 내 이름 폴더로
              바로 전송됩니다.
            </p>
            <p className="mt-1 text-base leading-7 text-[#54301d]">
              우측 상단 '보관함 보기'에서 본인이 업로드한 목록을 확인할 수
              있습니다.
            </p>
          </div>

          <div className="space-y-7 px-6 py-8 sm:px-10 sm:py-10">
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">
                  이름
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={60}
                  placeholder="예: 김기록"
                  disabled={isSending}
                  className="h-12 w-full rounded-none border border-[#dfbfae] bg-white/95 px-4 text-base outline-none transition placeholder:text-slate-400 focus:border-[#db6f31] focus:ring-4 focus:ring-[#fbe8dc] disabled:bg-white/95"
                />
              </label>
              <label className="block">
                <span className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <LockKeyhole size={15} aria-hidden="true" /> 업로드 코드
                </span>
                <input
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  type="password"
                  autoComplete="off"
                  placeholder="전달받은 코드"
                  disabled={isSending}
                  className="h-12 w-full rounded-none border border-[#dfbfae] bg-white/95 px-4 text-base outline-none transition placeholder:text-slate-400 focus:border-[#db6f31] focus:ring-4 focus:ring-[#fbe8dc] disabled:bg-white/95"
                />
              </label>
            </div>

            <div
              role="button"
              tabIndex={isSending ? -1 : 0}
              onClick={() => {
                if (!isSending) void chooseFiles();
              }}
              onKeyDown={(event) => {
                if (
                  !isSending &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  void chooseFiles();
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
              className="group cursor-pointer rounded-none border-2 border-dashed border-[#e4b99f] bg-white/95 px-5 py-10 text-center transition hover:border-[#db6f31] hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#fbe8dc] data-[disabled=true]:cursor-not-allowed sm:px-10"
              data-disabled={isSending}
              aria-label="원본 파일 선택"
            >
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-none bg-[#fbe8dc] text-[#db6f31] transition group-hover:scale-105">
                <UploadCloud size={29} aria-hidden="true" />
              </div>
              <p className="text-lg font-bold tracking-tight text-slate-900">
                원본 파일을 끌어놓거나 선택하세요
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                영상·사진 등 여러 파일을 선택할 수 있어요. 파일당 최대 100GB.
              </p>
              <input
                ref={fileInputRef}
                onChange={onFileChange}
                type="file"
                multiple
                className="sr-only"
              />
            </div>

            {items.length > 0 && (
              <section
                aria-live="polite"
                className="rounded-none border border-slate-200 bg-slate-50/70 p-4 sm:p-5"
              >
                <div className="mb-4 flex items-baseline justify-between gap-4">
                  <p className="font-bold tracking-tight text-slate-900">
                    선택한 파일 {items.length}개
                  </p>
                  <p className="text-sm font-medium text-slate-600">
                    총 {formatBytes(totalBytes)}
                  </p>
                </div>
                <div
                  className={
                    items.length > 10
                      ? "max-h-[720px] space-y-3 overflow-y-auto pr-2 [scrollbar-gutter:stable]"
                      : "space-y-3"
                  }
                >
                  {items.map((item) => {
                    const itemProgress =
                      item.file.size === 0
                        ? 0
                        : Math.round(
                            (item.uploadedBytes / item.file.size) * 100,
                          );
                    return (
                      <article
                        key={item.id}
                        className="rounded-none border border-slate-200 bg-white p-3.5"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <FileVideo
                            className="mt-0.5 shrink-0 text-[#db6f31]"
                            size={20}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex gap-3">
                              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                                {item.file.name}
                              </p>
                              <p className="shrink-0 text-sm text-slate-500">
                                {formatBytes(item.file.size)}
                              </p>
                            </div>
                            {item.state !== "waiting" && (
                              <>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-none bg-slate-100">
                                  <div
                                    className="h-full rounded-none bg-[#db6f31] transition-[width] duration-300"
                                    style={{ width: `${itemProgress}%` }}
                                  />
                                </div>
                                <p
                                  className={`mt-1.5 text-xs ${item.state === "error" ? "text-rose-700" : item.state === "complete" ? "text-emerald-700" : "text-slate-600"}`}
                                >
                                  {item.state === "uploading"
                                    ? `${itemProgress}% · ${item.message}`
                                    : item.message}
                                </p>
                              </>
                            )}
                          </div>
                          {item.state === "complete" && (
                            <CheckCircle2
                              className="shrink-0 text-emerald-600"
                              size={20}
                              aria-label="완료"
                            />
                          )}
                          {item.state === "uploading" && (
                            <LoaderCircle
                              className="shrink-0 animate-spin text-[#db6f31]"
                              size={20}
                              aria-label="업로드 중"
                            />
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {notice && (
              <p
                role="alert"
                className="rounded-none bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"
              >
                {notice}
              </p>
            )}

            {items.length > 0 && (
              <div>
                {isSending && (
                  <section
                    aria-live="polite"
                    className="mb-4 space-y-4 rounded-none border border-[#ecd6c8] bg-[#fff9f5] p-4"
                  >
                    <div>
                      <div className="flex items-baseline justify-between gap-4 text-sm">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800">
                            현재 파일 업로드 진행률
                          </p>
                          <p
                            className="mt-0.5 truncate text-xs text-slate-600"
                            title={currentItem?.file.name}
                          >
                            {currentItem
                              ? currentItem.file.name
                              : "다음 파일을 준비하는 중…"}
                          </p>
                        </div>
                        <span className="shrink-0 font-bold text-[#a84b19]">
                          {currentFileProgress}%
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-none bg-[#f4d9c9]">
                        <div
                          className="h-full rounded-none bg-[#db6f31] transition-[width] duration-300"
                          style={{ width: `${currentFileProgress}%` }}
                        />
                      </div>
                      {currentItem && (
                        <p className="mt-1.5 text-xs text-slate-600">
                          {formatBytes(currentItem.uploadedBytes)} /{" "}
                          {formatBytes(currentItem.file.size)}
                        </p>
                      )}
                    </div>

                    <div className="border-t border-[#eedbd0] pt-4">
                      <div className="flex items-baseline justify-between gap-4 text-sm">
                        <div>
                          <p className="font-bold text-slate-800">
                            전체 업로드 진행률
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600">
                            {items.length}개 중 {completedFileCount}개 저장됨 ·{" "}
                            {formatBytes(completedBytes)} /{" "}
                            {formatBytes(totalBytes)}
                          </p>
                        </div>
                        <span className="shrink-0 font-bold text-[#a84b19]">
                          {overallProgress}%
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-none bg-[#f4d9c9]">
                        <div
                          className="h-full rounded-none bg-[#db6f31] transition-[width] duration-300"
                          style={{ width: `${overallProgress}%` }}
                        />
                      </div>
                    </div>
                  </section>
                )}
                <button
                  type="button"
                  onClick={startUploads}
                  disabled={isSending}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-none bg-[#db6f31] px-5 text-base font-bold text-white shadow-sm transition hover:bg-[#b6541d] focus:outline-none focus:ring-4 focus:ring-[#f4c8ae] disabled:cursor-wait disabled:bg-slate-400"
                >
                  {isSending ? (
                    <LoaderCircle
                      className="animate-spin"
                      size={20}
                      aria-hidden="true"
                    />
                  ) : (
                    <UploadCloud size={20} aria-hidden="true" />
                  )}
                  {isSending ? "Drive로 보내는 중…" : "업로드 시작"}
                </button>
              </div>
            )}

            <div className="grid gap-3 border-t border-slate-100 pt-6 text-sm leading-6 text-slate-600 sm:grid-cols-2">
              <p className="flex gap-2">
                <ShieldCheck
                  className="mt-0.5 shrink-0 text-[#db6f31]"
                  size={18}
                  aria-hidden="true"
                />
                <span>
                  내 Drive에 파일이 복사되거나 저장되지 않습니다.
                  <br />
                  보관함은 보기 전용입니다.
                </span>
              </p>
              <p className="flex gap-2">
                <WifiOff
                  className="mt-0.5 shrink-0 text-[#db6f31]"
                  size={18}
                  aria-hidden="true"
                />
                <span>
                  전송 중에는 이 창을 열어 두세요.
                  <br />
                  연결이 잠시 끊겨도 자동으로 다시 시도합니다.
                </span>
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
