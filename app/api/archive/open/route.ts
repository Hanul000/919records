import { NextResponse } from "next/server";
import { archiveUrl } from "@/app/lib/drive";

export const runtime = "edge";

export async function GET() {
  const destination = await archiveUrl();
  if (!destination) return new NextResponse("보관함이 아직 연결되지 않았습니다.", { status: 404 });
  return NextResponse.redirect(destination);
}
