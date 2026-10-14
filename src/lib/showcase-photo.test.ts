import assert from "node:assert/strict";
import { homeShowcasePhotoUrl, showcasePhotoUrl } from "./showcase-photo";

const front = "https://ci.encar.com/carpicture02/pic4282/42820256_003.jpg";
const frontThreeQuarter = "https://ci.encar.com/carpicture02/pic4282/42820256_001.jpg";
const rearThreeQuarter = "https://ci.encar.com/carpicture02/pic4282/42820256_002.jpg";

assert.equal(
  homeShowcasePhotoUrl([
    { url: frontThreeQuarter, category: "outer", media_type: "image" },
    { url: rearThreeQuarter, category: "outer", media_type: "image" },
    { url: front, category: "outer", media_type: "image" },
  ]),
  frontThreeQuarter,
  "homepage cover should match the gallery cover even when 003 is labelled exterior",
);

assert.equal(
  homeShowcasePhotoUrl([
    { url: rearThreeQuarter, category: "outer", media_type: "image" },
  ]),
  null,
  "homepage cover should not fall back to a rear-facing frame",
);

assert.equal(
  homeShowcasePhotoUrl([
    { url: front, category: "inner", media_type: "image" },
    { url: frontThreeQuarter, category: "outer", media_type: "video" },
  ]),
  null,
  "non-exterior images and videos must not be used as homepage covers",
);

assert.equal(
  homeShowcasePhotoUrl([
    {
      url: `${front}?impolicy=heightRate&rh=768`,
      category: "outside_image",
      media_type: "image",
    },
  ]),
  `${front}?impolicy=heightRate&rh=768`,
  "transformed CDN URLs should retain their valid frontal frame",
);

console.log("Homepage showcase photo selection tests passed.");

const g90 = "https://ci.encar.com/carpicture04/pic4164/41647619";
assert.equal(showcasePhotoUrl([
  { url: `${g90}_005.jpg`, media_type: "image", category: "outer", is_primary: true, sort_order: 0 },
  { url: `${g90}_003.jpg`, media_type: "image", category: "outer", sort_order: 1 },
  { url: `${g90}_001.jpg`, media_type: "image", category: "outer", sort_order: 2 },
]), `${g90}_001.jpg`, "G90 cover must show the car, not the legacy primary wheel frame");
assert.equal(showcasePhotoUrl([
  { url: `${g90}_005.jpg`, media_type: "image", category: "outer", is_primary: true },
  { url: `${g90}_003.jpg?impolicy=heightRate&rh=768`, media_type: "image", category: "outer" },
]), `${g90}_003.jpg?impolicy=heightRate&rh=768`, "frontal fallback must outrank detail frames");
