import { NextResponse } from "next/server";
import { currentRole } from "@/lib/auth";
import { repository } from "@/lib/container";

/** 証拠写真の表示・ダウンロード（ログイン中の店主・スタッフ） */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentRole())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const file = await repository().getAttachment(id);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.meta.contentType,
      "Content-Length": String(file.meta.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.meta.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
