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
  // The feed's primary flag often points to a rear angle. Do not let it
  // influence showcase selection; the exterior-frame sequence is reliable.
  const primaryBonus = 0;
  if (["outside", "outside_image", "exterior", "outer"].includes(category)) {
    // Encar's regular exterior sequence is: 001 front three-quarter,
    // 002 rear three-quarter, 003 front, 004 rear. Prefer the two front
    // views and keep rear angles only as a fallback.
    const angleBonus =
      fileCode === 1 ? 140 :
      fileCode === 3 ? 130 :
      fileCode === 5 ? 90 :
      fileCode === 6 ? 75 :
      fileCode === 2 ? 25 :
      fileCode === 4 ? 15 :
      Number.isFinite(fileCode) && fileCode <= 8 ? 30 : 0;
    return 400 + angleBonus + primaryBonus;
  }
  if (category === "thumbnail") return 300 + (fileCode === 1 ? 30 : 0) + primaryBonus;
  if (category === "photo") return 260 + (fileCode >= 1 && fileCode <= 8 ? 20 - fileCode : 0) + primaryBonus;
  return 120 + primaryBonus;
}
