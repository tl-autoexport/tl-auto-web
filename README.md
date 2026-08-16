# TL Auto

Независимый веб-каталог TL Auto на Next.js 16 и Supabase. Публичная часть
показывает свежие объявления только из Encar, фотографии, отчёты состояния и
предварительный расчёт стоимости до Владивостока.

GitHub, Supabase и Vercel проекта должны принадлежать отдельным аккаунтам TL Auto.
Инфраструктура и секреты Autoexport не используются.

## Локальный запуск

Скопируйте `.env.example` в `.env.local`, заполните публичные ключи Supabase и
запустите:

```bash
npm ci
npm run dev
```

Сайт откроется на [http://localhost:3000](http://localhost:3000).

## Проверка перед публикацией

```bash
npm run check
npm run build
npm run audit:catalog
```

`npm run check:deploy-env` отдельно проверяет обязательные переменные и
публичный HTTPS-адрес. Секретный ключ Supabase используется только скриптами
обслуживания каталога и GitHub Actions; клиентскому приложению он не нужен.

## Автоматическое обновление каталога

Workflow `.github/workflows/catalog-sync.yml` ежедневно запускает безопасную
синхронизацию. Она проверяет минимальный объём каталога, долю исчезнувших
объявлений и присутствие приоритетных европейских марок до записи изменений.

Для workflow нужны GitHub Secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL` — нужен workflow миграций для таблицы снимков курсов
- `TELEGRAM_BOT_TOKEN` — необязательно, для уведомлений
- `TELEGRAM_CHAT_ID` — необязательно, для уведомлений

Безопасная предварительная проверка:

```bash
npm run sync:catalog
```

Запись только после успешной проверки:

```bash
npm run sync:catalog:write
```

История страховых случаев Encar проверяется отдельно:

```bash
npm run refresh:encar:history
npm run refresh:encar:history:write
```

Курсы для расчёта обновляются автоматически: ЦБ РФ и курс USDT/KRW Bithumb
проверяются каждые 15 минут, а активный каталог пересчитывается раз в сутки.
В расчёте сохраняются официальный курс ЦБ, поправка `+4%`, исходный и
скорректированный USDT/KRW (`−20 KRW`), а также время получения данных.
