import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 証拠写真のアップロード用（Vercelのリクエスト上限4.5MBより少し小さく）
    serverActions: { bodySizeLimit: "4.4mb" },
  },
};

export default nextConfig;
