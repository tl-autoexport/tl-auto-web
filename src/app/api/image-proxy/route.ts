import { NextRequest } from "next/server";

const allowedHosts = ["passo.co.kr", "encar.com"];

function isAllowedHost(hostname: string) {
  return allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return new Response("Missing image URL", { status: 400 });

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return new Response("Invalid image URL", { status: 400 });
  }

  if (!isAllowedHost(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    return new Response("Image host is not allowed", { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: `${url.protocol}//${url.host}/`,
        "User-Agent": "Mozilla/5.0 TL-Auto image proxy",
      },
      next: { revalidate: 3600 },
    });
    if (!upstream.ok) return new Response("Upstream image unavailable", { status: upstream.status });

    const upstreamContentType = upstream.headers.get("content-type") ?? "";
    // Passo serves JPEG files with a .img extension and application/octet-stream.
    // The bytes are still image data, so normalize that legacy response for the browser.
    const contentType = upstreamContentType.startsWith("image/")
      ? upstreamContentType
      : upstreamContentType === "application/octet-stream"
        ? "image/jpeg"
        : "";
    if (!contentType) return new Response("Upstream response is not an image", { status: 415 });

    return new Response(upstream.body, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        "Content-Type": contentType,
      },
    });
  } catch {
    return new Response("Image proxy request failed", { status: 502 });
  }
}
