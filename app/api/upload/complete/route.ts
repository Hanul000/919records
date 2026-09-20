import { NextResponse } from "next/server";
import { completeDriveUpload, isUploadCodeValid } from "@/app/lib/drive";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!isUploadCodeValid(body.accessCode)) {
      return NextResponse.json({ error: "업로드 코드가 맞지 않습니다." }, { status: 401 });
    }
    if (typeof body.uploadId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.uploadId)) {
      return NextResponse.json({ error: "업로드 정보를 확인할 수 없습니다." }, { status: 400 });
    }
    const fileId = typeof body.fileId === "string" && body.fileId.length < 200 ? body.fileId : null;
    await completeDriveUpload(body.uploadId, fileId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "저장 완료 상태를 기록하지 못했습니다." }, { status: 500 });
  }
}
