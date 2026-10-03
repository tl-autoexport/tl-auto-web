# Аудит названий TL Auto — шаг 1

Дата: 2026-10-03T07:06:00.334Z. Только чтение; записей в БД: 0; запросов к источникам объявлений: 0.

Проверено 10294 опубликованных машин по public.catalog_match. Проверена уникальность ID после объединения источников.

| Источник | Машин | Название поколения в карточке | Код поколения TL Auto | Комплектация в карточке | Комплектация в staging | Название комплектации доступно локально |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| chestny_prigon | 3041 | 3003 | 2048 | 0 | 3041 | 3041 |
| encar | 7253 | 88 | 0 | 2525 | 0 | 2716 |

«Название комплектации доступно локально» означает наличие строки в cars.trim, staging.trim, gradeDetailName/gradeDetailEnglishName или list.BadgeDetail снимка Encar (значения вроде «세부등급 없음» исключены). Это ещё не подтверждение правильности экранного названия. badge/grade сами по себе не считаются комплектацией.

## Сопоставление с Autoexport Web только по полному пути кодов

```json
{
  "chestny_prigon": {
    "generation": {
      "missing_source_codes": 2915,
      "exact_code_path": 126
    },
    "trim": {
      "generation_not_resolved": 2915,
      "missing_source_codes": 73,
      "not_in_loaded_dictionary": 45,
      "exact_code_path": 8
    }
  },
  "encar": {
    "generation": {
      "exact_code_path": 6423,
      "missing_source_codes": 830
    },
    "trim": {
      "not_in_loaded_dictionary": 1819,
      "exact_code_path": 1440,
      "missing_source_codes": 3156,
      "generation_not_resolved": 830,
      "duplicate_path_same_label": 8
    }
  }
}
```

Без кодов сопоставление на шаге 1 не предполагается. Пробное сопоставление строк, исправление названий и расширение словаря — шаг 2. Наличие английской подписи не означает, что она уже отредактирована для TL Auto.

## Частые исходные названия

| Источник | Поле | Значение | Машин |
| --- | --- | --- | ---: |
| encar | trim | Prestige | 356 |
| chestny_prigon | generation | 아반떼 (CN7) | 282 |
| chestny_prigon | staging_generation | 아반떼 (CN7) | 282 |
| chestny_prigon | generation | 쏘나타 (DN8) | 248 |
| chestny_prigon | staging_generation | 쏘나타 (DN8) | 248 |
| chestny_prigon | staging_trim | Modern | 240 |
| chestny_prigon | staging_trim | Prestige | 218 |
| encar | trim | Signature | 215 |
| encar | trim | Modern | 208 |
| encar | trim | Calligraphy | 188 |
| chestny_prigon | generation | K5 3세대 | 178 |
| chestny_prigon | staging_generation | K5 3세대 | 178 |
| chestny_prigon | staging_trim | Inspiration | 168 |
| chestny_prigon | generation | C-클래스 W205 | 152 |
| chestny_prigon | staging_generation | C-클래스 W205 | 152 |
| chestny_prigon | generation | 더 뉴 K3 2세대 | 144 |
| chestny_prigon | staging_generation | 더 뉴 K3 2세대 | 144 |
| encar | trim | Exclusive | 128 |
| chestny_prigon | staging_trim | Noblesse | 116 |
| encar | trim | Noblesse | 113 |
| chestny_prigon | staging_trim | Premium Plus | 112 |
| chestny_prigon | staging_trim | Smart | 105 |
| encar | trim | Premium | 103 |
| encar | trim | Inspiration | 102 |

## Результат проверки

Полный отчёт: output/catalog-naming/audit.json. Снимок таксономии: output/catalog-naming/taxonomy-snapshot.json. Исходные строки сохранены; каталог и сайт не изменены.

Следующий шаг: локальный справочник TL Auto и пробное сопоставление с учётом полных веток, регистров, аббревиатур и отдельных сущностей «поколение / модификация / комплектация».

## Выводы для проверки первого шага

- «Честный пригон»: у всех 3 041 машин исходная комплектация есть в staging.trim, хотя cars.trim пуст. Восстановление не требует новых запросов к источнику.
- Encar: cars.trim заполнено у 2 525 машин; ещё 191 название доступно в list.BadgeDetail сохранённых снимков. Итого 2 716 отдельных названий комплектации.
- Остальные 4 537 Encar не следует сразу объявлять машинами с потерянной комплектацией: часть имеет составную версию в badge/grade, часть моделей не имеет отдельного уровня комплектации. На шаге 2 эти ситуации разделяются.
- Исходное название поколения доступно у всех 7 253 Encar и у 3 004 машин «Честного пригона». Для 37 машин «Честного пригона» названия поколения пока нет. Исходная строка ещё требует нормализации.
- Полный путь кодов позволяет однозначно выбрать узел поколения для 6 423 Encar и 126 машин «Честного пригона», всего 6 549. Остальные переходят к сопоставлению исходных строк на шаге 2.
- Уникальный узел комплектации найден для 1 440 Encar и 8 машин «Честного пригона», всего 1 448. Для ещё 8 Encar Carnival обнаружены дубли веток с одинаковой подписью Signature; конфликта подписи нет, узлы нужно объединить на шаге 2.
- В Autoexport Web есть исходные подписи Canival и Santafe; локальные экранные названия TL Auto должны исправлять их на Carnival и Santa Fe.
- Проверены уникальность автомобилей, суммы групп и покрытие всех строк классификациями. TypeScript и ESLint нового скрипта проходят.

Шаг 1 завершён. Остановка для проверки пользователя. Записи в базы и изменения опубликованного интерфейса не выполнялись.
