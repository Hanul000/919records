import { NextResponse } from "next/server";
import { googleClientId, isSetupTokenValid, makeSetupState } from "@/app/lib/drive";

export const runtime = "edge";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  if (!isSetupTokenValid(incoming.searchParams.get("token"))) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const redirectUri = new URL("/api/setup/google/callback", incoming.origin).toString();
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      client_id: googleClientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/drive.file",
      state: await makeSetupState(),
    }).toString();
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive 연결을 시작하지 못했습니다.";
    return new NextResponse(message, { status: 503 });
  }
}
