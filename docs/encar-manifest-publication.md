# Публикация Encar по манифесту

`scripts/publish-encar-manifest.ts` принимает три отчёта одного enrichment run: план мощности, предварительный расчёт и аудит готовности. Аудит должен содержать только готовые карточки. Манифест фиксирует их ID, класс мощности, хеши отчётов и сохранённых исходных данных Encar. Скрипт не имеет жёстко заданного `run_id` или числа карточек.

Для партии `66c8b38e-1147-4f23-8735-6ebdd5bec4aa` использован план `output/tl-auto-new-encar-power-plan-66c8b38e-potential-preliminary.json`, 2 239 карточек. Отчёты `output/tl-auto-new-encar-preliminary-calculation-dry-run.json` и `output/tl-auto-new-encar-publication-readiness.json` относятся к тому же run. Манифест сохранён в `output/tl-auto-encar-publication-manifest.json`. Эти файлы нужно сохранять вместе: повторный запуск сверяет их содержимое с манифестом.

Для следующей партии задайте `TL_AUTO_POWER_PLAN`, `TL_AUTO_PRELIMINARY_CALCULATION`, `TL_AUTO_PUBLICATION_READINESS` и уникальный `TL_AUTO_PUBLICATION_MANIFEST`. После подготовки отчётов:

```bash
TL_AUTO_PUBLICATION_PREPARE=true npm run publish:encar:manifest
npm run publish:encar:manifest
TL_AUTO_PUBLICATION_WRITE=true TL_AUTO_PUBLICATION_PROBE=true npm run publish:encar:manifest
TL_AUTO_PUBLICATION_WRITE=true TL_AUTO_PUBLICATION_BATCH_SIZE=100 npm run publish:encar:manifest
```

Первая команда создаёт манифест и не перезаписывает существующий с другим составом. Вторая только проверяет данные. Третья вставляет одну карточку в транзакции и откатывает её. Последняя публикует пакетами до 100 карточек. Каждый пакет фиксируется после проверки числа карточек, фотографий, исходных и расчётных снимков. Повторный запуск пропускает уже опубликованные ID, проверив их принадлежность к run и полноту. Если исходные данные, отчёты, дата валютных курсов, выбранная мощность или состав партии изменились, скрипт останавливается.

Для партии 66c8b38e опубликованы все 2 239 ID из манифеста. Независимая сверка БД дала 2 239 доступных карточек, 2 239 с расчётным снимком, фото и исходным снимком, 0 карточек этого run вне манифеста. Из них 1 364 имеют approved spec в плане и 875 используют предварительную справочную мощность; фактический `power_finality` — 1 349 final и 890 provisional, поскольку T3 evidence не помечается как окончательное.
