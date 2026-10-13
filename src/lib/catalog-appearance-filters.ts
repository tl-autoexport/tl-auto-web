/** Curated Russian labels with source aliases verified in stored data and the Encar HAR. */
export const CATALOG_COLORS = [
  { id: "black", label: "Чёрный", swatch: "#17191d", aliases: ["Чёрный", "Черный", "검정색", "검정색투톤", "검은색", "검정", "검정투톤", "블랙"] },
  { id: "white", label: "Белый", swatch: "#fff", aliases: ["Белый", "흰색", "흰색투톤", "백색", "화이트", "진주색", "진주투톤", "펄"] },
  { id: "gray", label: "Серый", swatch: "#85888d", aliases: ["Серый", "Темно-серый", "회색", "그레이", "진회색", "쥐색", "시멘트"] },
  { id: "silver", label: "Серебристый", swatch: "#c3c6ca", aliases: ["Серебристый", "은하색", "은색", "은색투톤", "은회색", "은회색투톤", "실버"] },
  { id: "blue", label: "Синий", swatch: "#315aa8", aliases: ["Синий", "청색", "청색투톤", "파란색", "파랑", "블루", "청록색", "청옥색", "네이비", "남색"] },
  { id: "light-blue", label: "Голубой", swatch: "#77bce4", aliases: ["Голубой", "하늘색", "하늘"] },
  { id: "red", label: "Красный", swatch: "#c83e42", aliases: ["Красный", "빨간색", "적색", "레드"] },
  { id: "burgundy", label: "Бордовый", swatch: "#762c3c", aliases: ["Бордовый", "버건디", "보르도", "와인"] },
  { id: "green", label: "Зелёный", swatch: "#43845a", aliases: ["Зелёный", "Зеленый", "초록색", "연두색", "녹색", "그린"] },
  { id: "yellow", label: "Жёлтый", swatch: "#e3c83e", aliases: ["Жёлтый", "Желтый", "노란색", "노랑", "옐로"] },
  { id: "orange", label: "Оранжевый", swatch: "#e98a45", aliases: ["Оранжевый", "주황색", "오렌지"] },
  { id: "brown", label: "Коричневый", swatch: "#80604c", aliases: ["Коричневый", "갈색", "브라운"] },
  { id: "beige", label: "Бежевый", swatch: "#d7c2a0", aliases: ["Бежевый", "갈대색", "상아색", "베이지", "크림"] },
  { id: "gold", label: "Золотистый", swatch: "#c3a04f", aliases: ["Золотистый", "금색", "골드", "연금색"] },
  { id: "purple", label: "Фиолетовый", swatch: "#8553a6", aliases: ["Фиолетовый", "보라색", "자주색", "퍼플"] },
  { id: "pink", label: "Розовый", swatch: "#e99bb5", aliases: ["Розовый", "분홍색", "핑크"] },
  { id: "khaki", label: "Хаки", swatch: "#77764d", aliases: ["Хаки", "카키", "카키색"] },
] as const;

/**
 * Stable option IDs are separate from Encar codes: codes can be reused for
 * nested sub-options. Aliases are intentionally curated, never machine translated.
 */
export const CATALOG_OPTIONS = [
  { id: "sunroof", label: "Люк", group: "Комфорт", aliases: ["Люк", "선루프"] },
  { id: "heated-front-seats", label: "Подогрев передних сидений", group: "Сиденья", aliases: ["Подогрев передних сидений", "열선시트(앞좌석)", "열선시트(앞좌석, 뒷좌석)", "열선시트(앞·뒷좌석)"] },
  { id: "ventilated-front-seats", label: "Вентиляция передних сидений", group: "Сиденья", aliases: ["Вентиляция передних сидений", "통풍시트(운전석, 동승석)", "통풍시트(앞좌석)"] },
  { id: "leather-seats", label: "Кожаный салон", group: "Сиденья", aliases: ["Кожаный салон", "가죽시트"] },
  { id: "rear-camera", label: "Камера заднего вида", group: "Безопасность", aliases: ["Камера заднего вида", "후방 카메라"] },
  { id: "parking-sensors-front-rear", label: "Передние и задние парктроники", group: "Безопасность", aliases: ["Передние и задние парктроники", "주차감지센서(전방, 후방)"] },
  { id: "cruise-adaptive", label: "Адаптивный круиз-контроль", group: "Безопасность", aliases: ["Адаптивный круиз-контроль", "크루즈 컨트롤(어댑티브)", "스마트 크루즈 컨트롤(SCC)", "어댑티브 크루즈컨트롤(ACC)"] },
  { id: "navigation", label: "Навигация", group: "Мультимедиа", aliases: ["Навигация", "내비게이션", "내비게이션(정품)"] },
  { id: "surround-view", label: "Круговой обзор 360°", group: "Безопасность", aliases: ["Круговой обзор 360°", "360도 카메라", "360도 어라운드 뷰", "서라운드뷰 모니터(SVM)"] },
  { id: "blind-spot", label: "Контроль слепых зон", group: "Безопасность", aliases: ["Контроль слепых зон", "후측방 경보 시스템"] },
  { id: "side-airbags", label: "Боковые подушки безопасности", group: "Безопасность", aliases: ["Боковые подушки безопасности", "에어백(사이드)"] },
  { id: "lane-warning", label: "Контроль выхода из полосы", group: "Безопасность", aliases: ["Контроль выхода из полосы LDWS", "차선이탈 경보 시스템(LDWS)"] },
  { id: "abs", label: "Антиблокировочная система ABS", group: "Безопасность", aliases: ["Антиблокировочная система ABS", "브레이크 잠김 방지(ABS)"] },
  { id: "stability-control", label: "Система стабилизации ESC", group: "Безопасность", aliases: ["Система стабилизации ESC", "차체자세 제어장치(ESC)"] },
  { id: "panoramic-roof", label: "Панорамная крыша", group: "Комфорт", aliases: ["Панорамная крыша", "파노라마 선루프"] },
  { id: "electric-trunk", label: "Электропривод багажника", group: "Комфорт", aliases: ["Электропривод багажника", "전동식 트렁크", "파워 전동 트렁크", "파워 테일게이트(전동식 트렁크)"] },
  { id: "auto-climate", label: "Автоматический климат-контроль", group: "Комфорт", aliases: ["Автоматический климат-контроль", "풀오토 에어컨", "2존 풀오토에어컨", "전자동에어컨", "자동 에어컨"] },
  { id: "power-windows", label: "Электростеклоподъёмники", group: "Комфорт", aliases: ["Электростеклоподъемники", "Электростеклоподъёмники", "파워 윈도우"] },
  { id: "folding-mirrors", label: "Электроскладывание зеркал", group: "Комфорт", aliases: ["Электроскладывание зеркал", "전동접이미러", "전동접이 사이드 미러"] },
  { id: "electric-front-seats", label: "Электрорегулировка передних сидений", group: "Сиденья", aliases: ["Электрорегулировка передних сидений", "전동시트(앞좌석)", "전동시트(운전석, 동승석)"] },
  { id: "heated-steering-wheel", label: "Подогрев руля", group: "Комфорт", aliases: ["Подогрев руля", "열선 스티어링 휠"] },
  { id: "electric-parking-brake", label: "Электронный стояночный тормоз", group: "Безопасность", aliases: ["Электронный стояночный тормоз EPB", "전자식 주차브레이크(EPB)", "전자식 파킹브레이크(EPB)"] },
  { id: "head-up-display", label: "Проекционный дисплей HUD", group: "Мультимедиа", aliases: ["Проекционный дисплей HUD", "헤드업 디스플레이(HUD)"] },
  { id: "smart-key", label: "Смарт-ключ", group: "Комфорт", aliases: ["Смарт-ключ", "스마트키"] },
] as const;

export function colorAliases(ids: string[]) {
  const selected = new Set(ids);
  return CATALOG_COLORS.filter((color) => selected.has(color.id)).flatMap((color) => color.aliases);
}

export function optionAliases(ids: string[]) {
  const selected = new Set(ids);
  return CATALOG_OPTIONS.filter((option) => selected.has(option.id)).flatMap((option) => option.aliases);
}

export function parseFilterIds(value: string | string[] | undefined) {
  return [...new Set((Array.isArray(value) ? value : [value ?? ""]).flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean))];
}
