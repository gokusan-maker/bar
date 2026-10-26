import { redirect } from "next/navigation";
import { directory } from "@/lib/container";
import { DEFAULT_SHOP_ID } from "@/lib/domain/types";

/** 1店舗だったころの予約フォームのURL。店舗1の予約フォームへ移す（Instagram・LINEに貼ったリンクのため） */
export default async function OldReservePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const shop = await directory().getShop(DEFAULT_SHOP_ID);
  const q = new URLSearchParams(await searchParams).toString();
  redirect(`/s/${shop?.slug ?? "shop1"}/reserve${q ? `?${q}` : ""}`);
}
