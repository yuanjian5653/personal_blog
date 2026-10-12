import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 目前全站用的是原生 <img>，这里先按原样保留 next/image 的远程白名单；
  // 网易云图片 CDN（p1~p4）和用户头像都在 *.music.126.net 下，
  // 通配这一条即可 —— 原先重复列了 p1~p4 且 p1 写了两次。
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.music.126.net" }],
  },
};

export default nextConfig;