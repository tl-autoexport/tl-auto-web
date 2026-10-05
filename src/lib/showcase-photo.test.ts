import assert from "node:assert/strict";
import { homeShowcasePhotoUrl } from "./showcase-photo";

const front = "https://ci.encar.com/carpicture02/pic4282/42820256_003.jpg";
const frontThreeQuarter = "https://ci.encar.com/carpicture02/pic4282/42820256_001.jpg";
const rearThreeQuarter = "https://ci.encar.com/carpicture02/pic4282/42820256_002.jpg";

assert.equal(
  homeShowcasePhotoUrl([
    { url: frontThreeQuarter, category: "outer", media_type: "image" },
    { url: rearThreeQuarter, category: "outer", media_type: "image" },
    { url: front, category: "outer", media_type: "image" },
  ]),
  front,
  "homepage cover should prefer the frontal frame over three-quarter and rear frames",
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
