import { NextRequest } from "next/server";
import { isAllowedRemoteImageUrl } from "@/lib/media-url";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sourceUrl = request.nextUrl.searchParams.get("url");

  if (!sourceUrl || !isAllowedRemoteImageUrl(sourceUrl)) {
    return new Response("Invalid media URL", { status: 400 });
  }

  try {
    const upstream = await fetch(sourceUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: "https://www.encar.com/",
        "User-Agent": "Mozilla/5.0 (compatible; TL-Auto/1.0)",
      },
      cache: "force-cache",
      signal: AbortSignal.timeout(12_000),
    });

    if (!upstream.ok) {
      return new Response("Upstream media unavailable", { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return new Response("Invalid upstream media type", { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
        "Content-Type": contentType,
        ...(upstream.headers.get("content-length")
          ? { "Content-Length": upstream.headers.get("content-length")! }
          : {}),
      },
    });
  } catch {
    return new Response("Media proxy failed", { status: 502 });
  }
}
