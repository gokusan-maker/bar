import type { NextConfig } from "next";

/** すべての画面に付けるセキュリティのヘッダー（広告の表示を妨げないものだけ） */
const securityHeaders = [
  // ほかのサイトの中に埋め込ませない（クリックジャッキング対策）
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 証拠写真はファイル選択で撮るので、カメラなどの直接の利用は不要
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  experimental: {
    // 証拠写真のアップロード用（写真は送信前に縮小するので、この上限で足りる）
    serverActions: { bodySizeLimit: "4.4mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
