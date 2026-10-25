import qrcode from "qrcode-generator";

/** URLのQRコードをSVGにする（画面の色設定に関係なく白地に黒。読み取りやすいよう誤り訂正はM） */
export function qrSvg(text: string, size = 200): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 4;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  const full = n + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QRコード"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
