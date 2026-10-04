# Аудит названий TL Auto — шаг 1

Дата: 2026-10-04T07:24:12.372Z. Только чтение; записей в БД: 0; запросов к источникам объявлений: 0.

Проверено 10023 опубликованных машин по public.catalog_match. Проверена уникальность ID после объединения источников.

| Источник | Машин | Название поколения в карточке | Код поколения TL Auto | Комплектация в карточке | Комплектация в staging | Название комплектации доступно локально |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| chestny_prigon | 2911 | 2873 | 1949 | 0 | 2911 | 2911 |
| encar | 7112 | 87 | 0 | 2476 | 0 | 2660 |

«Название комплектации доступно локально» означает наличие строки в cars.trim, staging.trim, gradeDetailName/gradeDetailEnglishName или list.BadgeDetail снимка Encar (значения вроде «세부등급 없음» исключены). Это ещё не подтверждение правильности экранного названия. badge/grade сами по себе не считаются комплектацией.

## Сопоставление с Autoexport Web только по полному пути кодов

```json
{
  "chestny_prigon": {
    "generation": {
      "missing_source_codes": 2792,
      "exact_code_path": 119
    },
    "trim": {
      "generation_not_resolved": 2792,
      "missing_source_codes": 67,
      "not_in_loaded_dictionary": 44,
      "exact_code_path": 8
    }
  },
  "encar": {
    "generation": {
      "exact_code_path": 6314,
      "missing_source_codes": 798
    },
    "trim": {
      "not_in_loaded_dictionary": 1786,
      "exact_code_path": 1411,
      "missing_source_codes": 3109,
      "generation_not_resolved": 798,
      "duplicate_path_same_label": 8
    }
  }
}
```

Без кодов сопоставление на шаге 1 не предполагается. Пробное сопоставление строк, исправление названий и расширение словаря — шаг 2. Наличие английской подписи не означает, что она уже отредактирована для TL Auto.

## Частые исходные названия

| Источник | Поле | Значение | Машин |
| --- | --- | --- | ---: |
| encar | trim | Prestige | 353 |
| chestny_prigon | generation | 아반떼 (CN7) | 265 |
| chestny_prigon | staging_generation | 아반떼 (CN7) | 265 |
| chestny_prigon | generation | 쏘나타 (DN8) | 237 |
| chestny_prigon | staging_generation | 쏘나타 (DN8) | 237 |
| chestny_prigon | staging_trim | Modern | 226 |
| encar | trim | Signature | 210 |
| chestny_prigon | staging_trim | Prestige | 208 |
| encar | trim | Modern | 203 |
| encar | trim | Calligraphy | 184 |
| chestny_prigon | generation | K5 3세대 | 171 |
| chestny_prigon | staging_generation | K5 3세대 | 171 |
| chestny_prigon | staging_trim | Inspiration | 154 |
| chestny_prigon | generation | C-클래스 W205 | 150 |
| chestny_prigon | staging_generation | C-클래스 W205 | 150 |
| chestny_prigon | generation | 더 뉴 K3 2세대 | 137 |
| chestny_prigon | staging_generation | 더 뉴 K3 2세대 | 137 |
| encar | trim | Exclusive | 127 |
| encar | trim | Noblesse | 111 |
| chestny_prigon | staging_trim | Premium Plus | 109 |
| chestny_prigon | staging_trim | Noblesse | 108 |
| chestny_prigon | staging_trim | Signature | 100 |
| encar | trim | Premium | 100 |
| chestny_prigon | staging_trim | Smart | 99 |

## Результат проверки

Полный отчёт: output/catalog-naming/audit.json. Снимок таксономии: output/catalog-naming/taxonomy-snapshot.json. Исходные строки сохранены; каталог и сайт не изменены.

Следующий шаг: локальный справочник TL Auto и пробное сопоставление с учётом полных веток, регистров, аббревиатур и отдельных сущностей «поколение / модификация / комплектация».
