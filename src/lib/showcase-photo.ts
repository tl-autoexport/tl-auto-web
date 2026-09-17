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
  // `is_primary` comes from the source feed and can point to a rear view.
  // It should break ties, not outweigh a known front-facing exterior shot.
  const primaryBonus = media.is_primary ? 15 : 0;
  if (["outside", "outside_image", "exterior", "outer"].includes(category)) {
    // Encar's exterior sequence starts with the front/three-quarter views;
    // later frames are commonly rear, interior or detail shots.
    const angleBonus =
      fileCode === 2 ? 120 :
      fileCode === 3 ? 112 :
      fileCode === 4 ? 96 :
      fileCode === 5 ? 78 :
      fileCode === 6 ? 58 :
      fileCode === 1 ? 45 :
      Number.isFinite(fileCode) && fileCode <= 8 ? 30 : 0;
    return 400 + angleBonus + primaryBonus;
  }
  if (category === "thumbnail") return 300 + (fileCode === 1 ? 30 : 0) + primaryBonus;
  if (category === "photo") return 260 + (fileCode >= 1 && fileCode <= 8 ? 20 - fileCode : 0) + primaryBonus;
  return 120 + primaryBonus;
}
