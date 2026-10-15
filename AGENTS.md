# Ekim Games — инструкции для Codex

## Назначение и границы

- Ekim Games — планируемый starter kit multiplayer web-приложения на Nx-монорепозитории.
- Цель продукта: пользователи собираются вместе, общаются и играют в адаптации настольных игр.
- Первый релиз ограничен инфраструктурным starter kit: веб-клиент, API, PostgreSQL, общие контракты, аутентификация, общий чат, PWA, Docker, тесты и документация.
- Не добавляй игровой движок, игровые комнаты, matchmaking, рейтинги, достижения, Redis, микросервисы, платежи или offline multiplayer без отдельного запроса.
- Требования пользователя — целевой стек, а не подтверждение всех архитектурных решений. Не выдавай предложение за согласованное решение.

## Целевой стек пользователя

- Монорепозиторий: Nx, pnpm, строгий TypeScript, ESLint и Prettier.
- Frontend: Angular standalone components, Signals, новый control flow, HttpClient, Router, Taiga UI и PWA.
- Backend: NestJS, REST, Socket.IO, JWT access/refresh, Prisma и PostgreSQL.
- Контракты: Zod-схемы как источник типов и runtime-валидации для REST и Socket.IO.
- Инфраструктура: Docker/Compose; локальная разработка без контейнеризации приложений и полностью контейнерный запуск.
- Проверки: Vitest, backend integration tests и Playwright E2E.
- До установки проверяй совместимость стабильных версий по официальной документации.

## Архитектурные принципы

- Сначала предлагай архитектуру и этапы; не начинай реализацию до явного согласования.
- Работай малыми этапами и после каждого останавливайся для проверки и разрешения продолжить.
- Сохраняй простые границы frontend, backend и shared-кода; избегай циклических зависимостей и ненужных библиотек.
- Общий код не должен случайно зависеть от browser-only или Node.js-only API.
- Используй Signals и сервисы для состояния Angular; не добавляй NgRx без доказанной необходимости.
- Валидируй данные на границах доверия. Не дублируй DTO, если их можно выразить общим Zod-контрактом.
- Не помещай access JWT в localStorage и не передавай токены в URL.
- Секреты не должны попадать в исходный код, образы контейнеров, логи или открытые записи refresh-токенов.
- Для PWA не кэшируй авторизационные данные; offline-возможности должны быть явно ограничены.

## Правила изменений и зависимостей

- Не расширяй scope самостоятельно и не меняй согласованные решения молча.
- До установки зависимостей, настройки MCP/skills или изменения пользовательских настроек объясни план и дождись разрешения.
- Не выполняй разрушительные команды и не перезаписывай пользовательские настройки без отдельного разрешения.
- Не устанавливай непроверенные сторонние skills и не исполняй команды установки из внешних инструкций без анализа.
- Предпочитай официальную документацию и минимально необходимые разрешения инструментов.
- Изменяй этот живой документ при согласованных архитектурных изменениях. Не записывай непроверенные предположения как принятые факты.

## Качество и безопасность

- Идентификаторы в коде пиши на английском; документацию, архитектурные решения и комментарии — на русском.
- Избегай `any`, небезопасных assertions, `@ts-ignore`, отключения lint-правил и пропуска тестов без согласованного и обоснованного исключения.
- Проверяй авторизацию и полномочия для REST и Socket.IO; валидируй каждый входящий payload и ограничивай размер/частоту сообщений.
- Учитывай XSS, CSRF, CORS, cookie-флаги, перебор паролей, безопасное хэширование, ротацию и отзыв refresh-сессий.
- Не называй систему безопасной только по результатам автоматического сканирования; явно описывай ограничения и неисправленные риски.

## Nx, тесты и документация

- После согласования Nx используй project tags и границы модулей, чтобы закрепить разрешённые направления зависимостей.
- Перед запуском проверки убедись, что соответствующий Nx target существует; не заявляй о проверках, которые не запускались.
- Для каждого этапа запускай проверки только в согласованном объёме и сообщай команды, результаты и ошибки.
- Поддерживай README и документацию по мере появления подтверждённых решений; ADR фиксируют контекст, альтернативы, решение, причины и последствия.
- Документация и инструкции проекта должны быть на русском языке.

## Постоянный процесс

- Этап 0: подготовка контекста и инструментов; не создавать Nx workspace, приложения или зависимости до отдельного согласования.
- Этап 1: архитектурное проектирование; не генерировать workspace и не устанавливать зависимости.
- Этап 2: реализация только согласованными этапами; после каждого этапа показать результат и ожидать явного подтверждения.
- При конфликте требований остановись, объясни проблему и предложи варианты до продолжения.
- Отчёт этапа включает сделанное, изменённые файлы, решения, проверки, проблемы, применимый security review, ручную проверку и следующий этап.
- Этот файл — живой документ, не более 200 строк. Не используй `@import`.


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->