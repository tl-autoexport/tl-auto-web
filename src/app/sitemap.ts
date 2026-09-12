import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";
import { getSitemapCars } from "@/server/cars/repository";
import { publicCarPath } from "@/lib/car-url";

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
        publicCarPath(car.primary_source, car.source_id),
        siteUrl,
      ).toString(),
      lastModified: car.source_updated_at ?? undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
