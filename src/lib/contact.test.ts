import assert from "node:assert/strict";
import {
  telegramContactUrl,
  vehicleClientMessage,
  whatsappContactUrl,
} from "./contact";

const message = vehicleClientMessage({
  source: "encar",
  sourceId: "abc123",
  title: "Mercedes-Benz E-Class",
});

assert.match(message, /Mercedes-Benz E-Class/);
assert.match(message, /ID abc123/);
assert.doesNotMatch(message, /Encar|Chestny|chestny_prigon/);
const importedMessage = vehicleClientMessage({ source: "chestny_prigon", sourceId: "41730430", title: "Hyundai AVANTE" });
assert.match(importedMessage, /Hyundai AVANTE.*ID 41730430/);
assert.doesNotMatch(importedMessage, /Chestny|chestny_prigon|Честный пригон/i);
assert.equal(
  decodeURIComponent(telegramContactUrl(message)),
  `https://t.me/TL_Auto_export?text=${message}`,
);
assert.equal(
  decodeURIComponent(whatsappContactUrl(message)),
  `https://wa.me/821076260741?text=${message}`,
);

console.log("client contact links passed");
