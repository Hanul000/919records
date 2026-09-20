import { NextResponse } from "next/server";
import { beginDriveUpload, isUploadCodeValid, safeName, validFileSize } from "@/app/lib/drive";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!isUploadCodeValid(body.accessCode)) {
      return NextResponse.json({ error: "업로드 코드가 맞지 않습니다." }, { status: 401 });
    }
    if (!validFileSize(body.sizeBytes)) {
      return NextResponse.json({ error: "파일은 0바이트보다 크고 100GB 이하여야 합니다." }, { status: 400 });
    }

    const uploaderName = safeName(body.uploaderName, "이름 미입력", 60);
    if (uploaderName === "이름 미입력") {
      return NextResponse.json({ error: "이름을 입력해 주세요." }, { status: 400 });
    }
    const originalName = safeName(body.originalName, "unnamed-file", 180);
    const mimeType = typeof body.mimeType === "string" && body.mimeType.length < 160
      ? body.mimeType
      : "application/octet-stream";

    const upload = await beginDriveUpload({
      uploaderName,
      originalName,
      mimeType,
      sizeBytes: body.sizeBytes,
    });
    return NextResponse.json(upload, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "업로드를 준비하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
