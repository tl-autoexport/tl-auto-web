import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";
import { getSitemapCars } from "@/server/cars/repository";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const cars = await getSitemapCars();

  return [
    {
      url: new URL("/", siteUrl).toString(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: new URL("/catalog", siteUrl).toString(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: new URL("/privacy", siteUrl).toString(),
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: new URL("/terms", siteUrl).toString(),
      changeFrequency: "yearly",
      priority: 0.2,
    },
    ...cars.map((car) => ({
      url: new URL(
        `/cars/${encodeURIComponent(car.primary_source)}/${encodeURIComponent(car.source_id)}`,
        siteUrl,
      ).toString(),
      lastModified: car.source_updated_at ?? undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
