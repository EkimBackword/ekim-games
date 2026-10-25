# Ekim Games

Starter kit мультиплеерного веб-приложения на Nx: Angular web-клиент, NestJS API, PostgreSQL и общий чат.

## Локальный запуск

Требуются Node.js 24.22.0, nvm, pnpm 11.25.0 и Docker Desktop. В PowerShell установите и выберите нужную версию Node.js, затем при необходимости установите pnpm напрямую через npm:

```powershell
nvm install 24.22.0
nvm use 24.22.0
npm install --global pnpm@11.25.0
```

Проверьте версии командами `node --version` и `pnpm --version`. В корне репозитория `.nvmrc` закрепляет Node.js 24.22.0. PostgreSQL 18 запускается через Compose. Для автоматического создания `.env` с разными случайными секретами выполните:

```powershell
pnpm env:generate
```

Скрипт не перезаписывает существующий `.env`. Если создаёте его вручную из `.env.example`, задайте разные случайные hex-пароли для администратора PostgreSQL (`POSTGRES_PASSWORD`), роли миграций (`MIGRATION_DB_PASSWORD`) и роли приложения (`APP_DB_PASSWORD`), а также разные секреты JWT. Укажите пароль миграций в `MIGRATION_DATABASE_URL`, пароль приложения в `DATABASE_URL`.

Случайную hex-строку можно получить командой PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Затем запустите PostgreSQL и примените миграцию:

```powershell
pnpm db:up
# дождитесь статуса healthy у контейнера postgres в Docker Desktop
pnpm db:roles
pnpm db:migrate
pnpm db:generate
pnpm dev
```

Если volume PostgreSQL уже содержит базу, `POSTGRES_PASSWORD` применяется не повторно: значение в `.env` само по себе не меняет пароль существующей роли `ekim_games`. Если пароль в `.env` отличается от установленного в базе, смените пароль роли через локальное подключение к контейнеру:

```powershell
docker compose exec postgres psql -U ekim_games -d ekim_games
```

В приглашении `psql` выполните `\password ekim_games`, введите новый пароль, совпадающий с `POSTGRES_PASSWORD` в `.env`, затем выйдите командой `\q`. После этого повторите `pnpm db:roles`. Не удаляйте volume (`docker compose down -v`) ради смены пароля — это удалит данные базы.

Nx запускает web вместе с API. Откройте адрес, который выведет Angular dev server (обычно `http://localhost:4200`). Команда `pnpm db:down` останавливает контейнер PostgreSQL; volume с данными сохраняется.

Команда `db:roles` создаёт или обновляет отдельные роли: `ekim_games_migrate` становится владельцем базы и схемы и используется только Prisma migrations; `ekim_games_app` получает права только на чтение и изменение данных в `public`. В локальном Compose она также создаёт `ekim_games_shadow` для `prisma migrate dev`. Prisma берёт адрес этой базы из `SHADOW_DATABASE_URL`; если переменная отсутствует, он формирует адрес, заменяя имя базы в `MIGRATION_DATABASE_URL` на `ekim_games_shadow`. Shadow database нужна только для разработки миграций и очищается Prisma при запуске `migrate dev`; `migrate deploy` в production её не использует. `ekim_games` из `POSTGRES_USER` — административная роль только для настройки пользователей и прав. Для существующей базы настройка переносит владение пользовательскими таблицами, последовательностями и типами в схеме `public` к роли миграций, не затрагивая системные объекты и не удаляя volume. API читает `DATABASE_URL`, Prisma CLI — `MIGRATION_DATABASE_URL`. `.env` исключён из Git. Не подставляйте один и тот же секрет для access и refresh JWT. Для production задайте `COOKIE_SECURE=true` и обслуживайте приложение по HTTPS.

## Запуск всего приложения в Docker

Для контейнерного режима подготовьте отдельный файл окружения:

```powershell
Copy-Item .env.production.example .env.production
```

Задайте в `.env.production` разные случайные hex-пароли `POSTGRES_PASSWORD`, `MIGRATION_DB_PASSWORD` и `APP_DB_PASSWORD`, а также уникальные секреты JWT. Для локального запуска через HTTP установите `WEB_ORIGIN=http://localhost:8080` и `COOKIE_SECURE=false`. Compose настроит роли до миграций; контейнер миграций подключается как владелец базы, а API — как `ekim_games_app`. Затем соберите образы и запустите стек:

```powershell
pnpm docker:up
pnpm docker:ps
```

Откройте `http://localhost:8080`. Compose дождётся готовности PostgreSQL, применит Prisma migrations, затем запустит API и Nginx. Nginx отдаёт Angular-приложение и проксирует `/api/**` и Socket.IO `/socket.io/**` к API. PostgreSQL не публикует порт в этом режиме. Данные сохраняются в отдельном Docker volume.

Для остановки используйте `pnpm docker:down`; команда сохраняет volume с базой. `pnpm docker:logs` показывает логи сервисов. Файл `.env.production` не включается в Git и исключён из Docker build context; секреты передаются контейнерам во время запуска и не записываются в Docker images.

На VPS оставьте `APP_BIND_ADDRESS=127.0.0.1`, задайте HTTPS origin сайта и `COOKIE_SECURE=true`. Настройте host Nginx как TLS reverse proxy на `127.0.0.1:8080`; передавайте `X-Forwarded-Proto` и WebSocket upgrade headers для Socket.IO. PostgreSQL остаётся доступен только во внутренней Docker-сети.

Health checks проверяют PostgreSQL (`pg_isready`), API (`GET /api/health`, включая запрос к базе) и Nginx (`GET /healthz`).

## Аутентификация и чат

- Никнейм уникален без учёта регистра; перед сравнением сервер нормализует Unicode (NFKC) и приводит строку к нижнему регистру.
- Пароли длиной 12–128 символов хэшируются Argon2id с уникальной случайной солью; параметры хэша сохраняются в стандартной PHC-строке.
- Access JWT действует 10 минут и хранится только в памяти веб-клиента. Refresh JWT живёт до 7 дней, передаётся в HttpOnly cookie, в базе хранится только SHA-256-хэш. Каждый refresh ротирует токен; повторное использование старого токена отзывает сессию.
- Cookie используют `SameSite=Strict`; production включает `Secure`. Refresh и logout дополнительно проверяют CSRF cookie и заголовок.
- REST и Socket.IO проверяют access JWT и активность сессии. Socket.IO получает токен только в handshake `auth`, не в URL.
- Текст сообщения ограничен 2000 символами. HTTP body — 16 КБ; Socket.IO payload — 16 КБ. REST имеет общий лимит запросов, а регистрация, вход и отправка сообщений ограничены отдельно.
- Сообщения сохраняются в PostgreSQL. Socket.IO рассылает только сообщение, уже записанное в базу.

Socket.IO rate limit хранится в памяти одного процесса: перед production с несколькими API экземплярами его нужно перенести в общее хранилище или ограничить горизонтальное масштабирование. Access JWT отзывается вместе с refresh-сессией на каждой REST-проверке и при каждой отправке Socket.IO; уже открытый socket отключается, когда сервер обнаруживает отозванную сессию.

## PWA и работа без сети

В production веб-клиент регистрирует Angular service worker и предварительно кэширует оболочку приложения: HTML, JavaScript, CSS, иконки и статические ресурсы. При повторном открытии без сети браузер может загрузить уже сохранённую оболочку; интерфейс предупреждает, что вход и чат требуют подключения.

API (`/api/**`) и Socket.IO (`/socket.io/**`) не включены в кэш. Конфигурация не использует `dataGroups`, поэтому ответы API, сообщения чата, токены и cookies не сохраняются service worker. PWA не предоставляет offline-аутентификацию, отправку сообщений или сохранение черновиков.

Service worker включён только для production-сборки. Для проверки установите production-сборку за HTTPS-сервером (для локальной проверки допустим `localhost`), откройте приложение онлайн, затем перезагрузите его без сети. Новая версия приложения загружается service worker в фоне и применяется при следующем открытии/перезагрузке страницы; чтобы проверить срочный деплой, закройте остальные вкладки приложения и откройте его снова.

## Проверки

```powershell
pnpm nx run api:build
pnpm nx run web:build
pnpm nx run-many -t lint -p api web contracts
```

### Проверки API и браузерный сценарий

API integration и Playwright E2E запускаются через Nx. Для них требуется работающий Docker Desktop и установленный браузер Chromium Playwright:

```powershell
pnpm exec playwright install chromium
pnpm nx run api:integration-test
pnpm nx run web:e2e
```

Каждый запуск поднимает отдельный PostgreSQL Compose-проект со случайным именем и портом, применяет миграции и удаляет только этот тестовый проект вместе с его volume после завершения. Локальная dev-база проекта не используется.
