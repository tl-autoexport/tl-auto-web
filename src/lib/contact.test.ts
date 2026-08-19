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
assert.match(message, /Encar, ID abc123/);
assert.equal(
  decodeURIComponent(telegramContactUrl(message)),
  `https://t.me/TL_Auto_export?text=${message}`,
);
assert.equal(
  decodeURIComponent(whatsappContactUrl(message)),
  `https://wa.me/821076260741?text=${message}`,
);

console.log("client contact links passed");
