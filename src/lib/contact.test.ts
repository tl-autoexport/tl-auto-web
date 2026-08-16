import assert from "node:assert/strict";
import {
  telegramContactUrl,
  vehicleDeveloperMessage,
  whatsappContactUrl,
} from "./contact";

const message = vehicleDeveloperMessage({
  source: "encar",
  sourceId: "abc123",
  title: "Mercedes-Benz E-Class",
});

assert.match(message, /Mercedes-Benz E-Class/);
assert.match(message, /Encar, ID abc123/);
assert.equal(
  decodeURIComponent(telegramContactUrl(message)),
  `https://t.me/koreakim88?text=${message}`,
);
assert.equal(
  decodeURIComponent(whatsappContactUrl(message)),
  `https://wa.me/77755215309?text=${message}`,
);

console.log("developer contact links passed");
