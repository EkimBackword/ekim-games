# Ekim Games

Starter kit мультиплеерного веб-приложения на Nx: Angular web-клиент, NestJS API, PostgreSQL и общий чат.

## Локальный запуск

Требуются Node.js 24, Corepack и Docker Desktop. PostgreSQL 18 запускается через Compose. Сначала создайте `.env` из `.env.example`. Замените оба JWT placeholder разными случайными значениями минимум по 32 символа. Задайте случайный hex-пароль PostgreSQL и укажите его одинаково в `POSTGRES_PASSWORD` и в пароле `DATABASE_URL`.

Случайную hex-строку можно получить командой PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Затем запустите PostgreSQL и примените миграцию:

```powershell
corepack pnpm db:up
# дождитесь статуса healthy у контейнера postgres в Docker Desktop
corepack pnpm db:migrate
corepack pnpm db:generate
corepack pnpm dev
```

Nx запускает web вместе с API. Откройте адрес, который выведет Angular dev server (обычно `http://localhost:4200`). Команда `corepack pnpm db:down` останавливает контейнер PostgreSQL; volume с данными сохраняется.

Для локальной разработки API читает `.env`. Этот файл исключён из Git. Не подставляйте один и тот же секрет для access и refresh JWT. Для production задайте `COOKIE_SECURE=true` и обслуживайте приложение по HTTPS.

## Запуск всего приложения в Docker

Для контейнерного режима подготовьте отдельный файл окружения:

```powershell
Copy-Item .env.production.example .env.production
```

Задайте в `.env.production` уникальные секреты PostgreSQL и JWT. Для локального запуска через HTTP установите `WEB_ORIGIN=http://localhost:8080` и `COOKIE_SECURE=false`. Затем соберите образы и запустите стек:

```powershell
corepack pnpm docker:up
corepack pnpm docker:ps
```

Откройте `http://localhost:8080`. Compose дождётся готовности PostgreSQL, применит Prisma migrations, затем запустит API и Nginx. Nginx отдаёт Angular-приложение и проксирует `/api/**` и Socket.IO `/socket.io/**` к API. PostgreSQL не публикует порт в этом режиме. Данные сохраняются в отдельном Docker volume.

Для остановки используйте `corepack pnpm docker:down`; команда сохраняет volume с базой. `corepack pnpm docker:logs` показывает логи сервисов. Файл `.env.production` не включается в Git и исключён из Docker build context; секреты передаются контейнерам во время запуска и не записываются в Docker images.

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

Интеграционные и E2E проверки настраиваются отдельным этапом.
