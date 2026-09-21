import { NextResponse } from "next/server";
import { getCatalogPreviewImages } from "@/server/cars/repository";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const source = params.get("source") ?? "";
  const sourceId = params.get("sourceId") ?? "";
  if (!source || !sourceId || source.length > 40 || sourceId.length > 120) {
    return NextResponse.json({ images: [] }, { status: 400 });
  }

  return NextResponse.json(
    { images: await getCatalogPreviewImages(source, sourceId) },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
  );
}
