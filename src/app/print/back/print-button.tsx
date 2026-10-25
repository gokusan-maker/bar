"use client";

/** ブラウザの印刷画面を開く。「PDFに保存」を選ぶとPDFになる */
export function PrintButton() {
  return (
    <button type="button" className="primary" onClick={() => window.print()}>
      PDFで保存・印刷
    </button>
  );
}
