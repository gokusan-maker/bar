"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 画面を開いている間、一定間隔で最新の内容に更新する（新しい注文に気づけるように） */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
