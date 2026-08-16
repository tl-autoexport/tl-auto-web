import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const yandexMetrikaOrigins = [
  "https://mc.yandex.ru",
  "https://mc.yandex.az",
  "https://mc.yandex.by",
  "https://mc.yandex.co.il",
  "https://mc.yandex.com",
  "https://mc.yandex.com.am",
  "https://mc.yandex.com.ge",
  "https://mc.yandex.com.tr",
  "https://mc.yandex.ee",
  "https://mc.yandex.fr",
  "https://mc.yandex.kg",
  "https://mc.yandex.kz",
  "https://mc.yandex.lt",
  "https://mc.yandex.lv",
  "https://mc.yandex.md",
  "https://mc.yandex.tj",
  "https://mc.yandex.tm",
  "https://mc.yandex.uz",
  "https://mc.webvisor.com",
  "https://mc.webvisor.org",
];

const yandexMetrikaWebSocketOrigins = [
  "wss://mc.yandex.ru",
  "wss://mc.yandex.az",
  "wss://mc.yandex.by",
  "wss://mc.yandex.co.il",
  "wss://mc.yandex.com",
  "wss://mc.yandex.com.am",
  "wss://mc.yandex.com.ge",
  "wss://mc.yandex.com.tr",
  "wss://mc.yandex.ee",
  "wss://mc.yandex.fr",
  "wss://mc.yandex.kg",
  "wss://mc.yandex.kz",
  "wss://mc.yandex.lt",
  "wss://mc.yandex.lv",
  "wss://mc.yandex.md",
  "wss://mc.yandex.tj",
  "wss://mc.yandex.tm",
  "wss://mc.yandex.uz",
  "wss://mc.webvisor.com",
  "wss://mc.webvisor.org",
];

const yandexMetrikaFrameAncestors = [
  "https://metrika.yandex.ru",
  "https://analytics.yandex.by",
  "https://analytics.yandex.com",
  "https://analytics.yandex.com.tr",
  "https://analytics.yandex.kz",
  "https://analytics.yandex.ru",
  "https://metr.yandex.by",
  "https://metr.yandex.com",
  "https://metr.yandex.com.tr",
  "https://metr.yandex.kz",
  "https://metr.yandex.ru",
  "https://metrica.ya.ru",
  "https://metrica.yandex",
  "https://metrica.yandex.by",
  "https://metrica.yandex.com",
  "https://metrica.yandex.com.tr",
  "https://metrica.yandex.kz",
  "https://metrica.yandex.ru",
  "https://metrika.ya.ru",
  "https://metrika.yandex",
  "https://metrika.yandex.by",
  "https://metrika.yandex.com",
  "https://metrika.yandex.com.tr",
  "https://metrika.yandex.kz",
  "https://metrika.yandex.uz",
];

const yandexMetrikaConnections = [
  ...yandexMetrikaOrigins,
  ...yandexMetrikaWebSocketOrigins,
  "https://yastatic.net",
].join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://mc.yandex.ru https://yastatic.net${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${yandexMetrikaConnections}`,
  "media-src 'self' blob: https://d2avc2iz4eoo2p.cloudfront.net https://prnd-car-purchase.s3.ap-northeast-2.amazonaws.com",
  `child-src blob: ${yandexMetrikaOrigins.join(" ")}`,
  `frame-src blob: https://d1mfhizjlo84v0.cloudfront.net ${yandexMetrikaOrigins.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `frame-ancestors 'self' ${yandexMetrikaFrameAncestors.join(" ")}`,
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0",
          },
        ],
      },
    ];
  },
  images: {
    minimumCacheTTL: 604800,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ci.encar.com",
      },
      {
        protocol: "https",
        hostname: "prnd-car-purchase.s3.ap-northeast-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "heydealer-api.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "d1mfhizjlo84v0.cloudfront.net",
      },
    ],
  },
};

export default nextConfig;
