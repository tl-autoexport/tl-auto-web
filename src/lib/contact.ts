export const DEVELOPER_CONTACT = {
  telegramUsername: "koreakim88",
  whatsappPhone: "77755215309",
  whatsappLabel: "+7 775 521-53-09",
} as const;

export const GENERAL_DEVELOPER_MESSAGE =
  "Здравствуйте! Меня заинтересовал автомобиль на сайте TL Auto. Хочу получить подробную консультацию.";

export function telegramContactUrl(message = GENERAL_DEVELOPER_MESSAGE) {
  return `https://t.me/${DEVELOPER_CONTACT.telegramUsername}?text=${encodeURIComponent(message)}`;
}

export function whatsappContactUrl(message = GENERAL_DEVELOPER_MESSAGE) {
  return `https://wa.me/${DEVELOPER_CONTACT.whatsappPhone}?text=${encodeURIComponent(message)}`;
}

export function vehicleDeveloperMessage({
  source,
  sourceId,
  title,
}: {
  source: string;
  sourceId: string;
  title: string;
}) {
  const sourceLabel = "Encar";
  return `Здравствуйте! Меня заинтересовал автомобиль «${title}» (${sourceLabel}, ID ${sourceId}) на сайте TL Auto. Хочу получить подробную консультацию.`;
}
