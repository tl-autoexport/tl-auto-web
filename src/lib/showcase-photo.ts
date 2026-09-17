type ShowcaseMedia = {
  url: string;
  media_type?: string | null;
  category?: string | null;
  is_primary?: boolean | null;
  sort_order?: number | null;
};

const NON_SHOWCASE_CATEGORIES = [
  "inner",
  "inside",
  "inside_image",
  "interior",
  "option",
  "condition",
  "scratch",
  "inspection_record",
  "underbody",
  "thermal",
  "thermal_reference",
  "exterior_360_thumbnail",
];

export function showcasePhotoUrl(media: ShowcaseMedia[] | null | undefined) {
  const images = (media ?? []).filter((item) => item.media_type === "image" && item.url);
  const ranked = images
    .map((item, index) => ({ item, score: showcasePhotoScore(item), index }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      Number(right.item.is_primary) - Number(left.item.is_primary) ||
      (left.item.sort_order ?? left.index) - (right.item.sort_order ?? right.index),
    );

  return ranked[0]?.item.url ?? images[0]?.url ?? null;
}

function showcasePhotoScore(media: ShowcaseMedia) {
  const category = media.category?.toLowerCase() ?? "";
  if (NON_SHOWCASE_CATEGORIES.some((blocked) => category === blocked || category.startsWith(`${blocked}_`))) return 0;

  const fileCode = Number(media.url.match(/_(\d{3})(?:\.[a-z]+)(?:\?|$)/i)?.[1] ?? NaN);
  const primaryBonus = media.is_primary ? 80 : 0;
  if (["outside", "outside_image", "exterior", "outer"].includes(category)) {
    const angleBonus = fileCode === 2 ? 55 : fileCode === 3 ? 50 : fileCode === 4 ? 35 : fileCode === 1 ? 18 : 0;
    return 300 + angleBonus + primaryBonus;
  }
  if (category === "thumbnail") return 280 + (fileCode === 1 ? 30 : 0) + primaryBonus;
  if (category === "photo") return 220 + (fileCode >= 1 && fileCode <= 8 ? 20 - fileCode : 0) + primaryBonus;
  return 120 + primaryBonus;
}
