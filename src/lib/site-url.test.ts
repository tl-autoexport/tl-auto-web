import assert from "node:assert/strict";
import { normalizeSiteUrl } from "./site-url";

assert.equal(
  normalizeSiteUrl("tl-auto-preview.vercel.app/catalog?x=1").toString(),
  "https://tl-auto-preview.vercel.app/",
);
assert.equal(
  normalizeSiteUrl("http://localhost:3000/catalog").toString(),
  "http://localhost:3000/",
);

console.log("site URL normalization passed");
