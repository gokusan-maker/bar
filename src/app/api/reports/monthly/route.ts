import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { salesService } from "@/lib/container";
import { reportCsv } from "@/lib/domain/sales";

/** 月のバック一覧CSV（給与計算用） */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "month=YYYY-MM を指定してください" }, { status: 400 });
  }
  const csv = reportCsv(await salesService().report(month));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="back-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
