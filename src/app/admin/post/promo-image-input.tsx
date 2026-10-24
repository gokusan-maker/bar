"use client";

import { useRef, useState } from "react";

/** Instagram投稿用に、どの形式の写真も長辺1080pxのJPEGにしてから送る（InstagramのAPIはJPEGのみ） */
async function toJpeg(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1080 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return blob ? new File([blob], "promo.jpg", { type: "image/jpeg" }) : null;
  } catch {
    return null;
  }
}

export function PromoImageInput() {
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function onChange() {
    const input = ref.current!;
    const file = input.files?.[0];
    if (!file) return setStatus(null);
    setStatus("画像を準備しています…");
    const jpeg = await toJpeg(file);
    if (!jpeg) {
      input.setCustomValidity("この画像は読み込めませんでした。別の画像を選んでください。");
      setStatus("この画像は読み込めませんでした。");
    } else {
      const dt = new DataTransfer();
      dt.items.add(jpeg);
      input.files = dt.files;
      input.setCustomValidity("");
      setStatus(`準備できました（${Math.round(jpeg.size / 1024)}KB）`);
    }
    input.reportValidity();
  }

  return (
    <label>
      投稿に使う画像（お店の写真・メニューなど）
      <input ref={ref} type="file" name="image" accept="image/*" required onChange={onChange} />
      {status && <span className="muted">{status}</span>}
    </label>
  );
}
