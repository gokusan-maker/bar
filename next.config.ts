import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 証拠写真のアップロード用（写真は送信前に縮小するので、この上限で足りる）
    serverActions: { bodySizeLimit: "4.4mb" },
  },
};

export default nextConfig;
