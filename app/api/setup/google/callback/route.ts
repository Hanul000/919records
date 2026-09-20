import { NextResponse } from "next/server";
import { connectGoogleDrive, verifySetupState } from "@/app/lib/drive";

export const runtime = "edge";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const code = incoming.searchParams.get("code");
  const stateIsValid = await verifySetupState(incoming.searchParams.get("state"));
  if (!code || !stateIsValid) {
    return new NextResponse("Google Drive 연결을 확인하지 못했습니다. 처음부터 다시 시도해 주세요.", { status: 400 });
  }

  try {
    await connectGoogleDrive(code, new URL("/api/setup/google/callback", incoming.origin).toString());
    return NextResponse.redirect(new URL("/?setup=connected", incoming.origin));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive 연결을 완료하지 못했습니다.";
    return new NextResponse(message, { status: 500 });
  }
}
