export const CLIENT_CONTACT = {
  telegramUsername: "TL_Auto_export",
  maxUrl: "https://max.ru/u/f9LHodD0cOIbbrnixgCklxVJDZIlM34DRERMCzVgn9RAgFkAEE2giwsuORA",
  whatsappCarPhone: "821076260741",
  whatsappPowersportsPhone: "821067986644",
  whatsappCarLabel: "Заявка на авто 🚘",
  whatsappPowersportsLabel: "Заявка на гидроциклы и мототехнику",
  instagramUrl: "https://www.instagram.com/tl_auto_export/",
  youtubeUrl: "https://youtube.com/@tl_auto_export?si=8VYlz-wvmUO87cuF",
  tiktokUrl: "https://www.tiktok.com/@tl_auto?_r=1&_t=ZS-992jL22Sud2",
} as const;

export const GENERAL_CLIENT_MESSAGE =
  "Здравствуйте! Меня заинтересовало объявление на сайте TL Auto. Хочу получить подробную консультацию.";

export function telegramContactUrl(message = GENERAL_CLIENT_MESSAGE) {
  return `https://t.me/${CLIENT_CONTACT.telegramUsername}?text=${encodeURIComponent(message)}`;
}

export function whatsappContactUrl(message = GENERAL_CLIENT_MESSAGE) {
  return `https://wa.me/${CLIENT_CONTACT.whatsappCarPhone}?text=${encodeURIComponent(message)}`;
}

export function whatsappPowersportsContactUrl(message = GENERAL_CLIENT_MESSAGE) {
  return `https://wa.me/${CLIENT_CONTACT.whatsappPowersportsPhone}?text=${encodeURIComponent(message)}`;
}

export function vehicleClientMessage({
  source,
  sourceId,
  title,
}: {
  source: string;
  sourceId: string;
  title: string;
}) {
  const sourceLabel = source === "encar" ? "Encar" : source;
  return `Здравствуйте! Меня заинтересовал автомобиль «${title}» (${sourceLabel}, ID ${sourceId}) на сайте TL Auto. Хочу получить подробную консультацию.`;
}
