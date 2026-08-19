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

## Публикация на GitHub и Vercel

1. Создайте приватный или публичный репозиторий в отдельном GitHub-аккаунте TL
   Auto и отправьте в него ветку `main`. Файлы `.env.local`, `.env` и локальное
   состояние Supabase уже исключены из git.
2. В Vercel выберите `Add New...` → `Project`, импортируйте этот GitHub-
   репозиторий и оставьте framework `Next.js`. Конфигурация проекта закреплена
   в `vercel.json`; команды установки и сборки используют `npm ci` и
   `npm run build`.
3. Добавьте в Vercel → `Settings` → `Environment Variables` для `Production`,
   `Preview` и `Development`:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` — канонический HTTPS-домен production; для Preview
     можно оставить значение пустым, тогда используется URL Vercel.

   `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, токены Encar и Telegram в Vercel
   не добавляйте: они нужны только обслуживающим скриптам GitHub Actions.
4. После привязки собственного домена замените `NEXT_PUBLIC_SITE_URL` на его
   HTTPS-адрес и запустите новый production deploy. Preview-деплои автоматически
   закрыты от индексации через `robots.txt` и metadata.

Для GitHub Actions добавьте в `Settings` → `Secrets and variables` → `Actions`
следующие Secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL`
- `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` — необязательно

Workflow `ci.yml` проверяет pull request и push в `main`; остальные workflow
обновляют каталог и расчётные курсы по расписанию. Миграции Supabase запускайте
отдельно после проверки SQL и перед первым production deploy.

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
