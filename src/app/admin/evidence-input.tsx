"use client";

import { useRef, useState } from "react";

const MAX_TOTAL_BYTES = 4.2 * 1024 * 1024;
const RESIZE_OVER_BYTES = 800 * 1024;
const MAX_EDGE = 1600;

/** スマホの写真は大きいので、送信前に長辺1600pxのJPEGに縮小する */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= RESIZE_OVER_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

export function EvidenceInput({ label = "証拠（伝票・レシートの写真、PDF）" }: { label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function onChange() {
    const input = ref.current!;
    const files = [...(input.files ?? [])];
    if (!files.length) {
      setStatus(null);
      return;
    }
    setStatus("写真を準備しています…");
    const shrunk = await Promise.all(files.map(shrink));
    const dt = new DataTransfer();
    shrunk.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    const total = shrunk.reduce((n, f) => n + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      input.setCustomValidity("一度に送れるのは合計4MBまでです。枚数を減らしてください。");
      setStatus(`合計 ${mb(total)}：大きすぎます。枚数を減らすか、何回かに分けて追加してください。`);
    } else {
      input.setCustomValidity("");
      setStatus(`${shrunk.length}件（合計 ${mb(total)}）`);
    }
    input.reportValidity();
  }

  return (
    <label>
      {label}
      <input
        ref={ref}
        type="file"
        name="files"
        multiple
        accept="image/*,application/pdf"
        onChange={onChange}
      />
      {status && <span className="muted">{status}</span>}
    </label>
  );
}
