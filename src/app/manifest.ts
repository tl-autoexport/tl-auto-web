import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TL Auto — автомобили из Кореи",
    short_name: "TL Auto",
    description:
      "Каталог автомобилей из Кореи с расчётом стоимости до Владивостока.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#10243e",
    lang: "ru",
  };
}
