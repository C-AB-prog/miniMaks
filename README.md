# 🎯 miniMaks — Business Task Manager

Telegram Mini App для управления проектами и задачами с ИИ-ассистентом.

## Архитектура

```
miniMaks/
├── apps/
│   ├── api/          → Fastify API (Node.js + Prisma + PostgreSQL)
│   ├── web/          → React SPA (Vite + TypeScript)
│   └── worker/       → BullMQ worker (уведомления + cron)
├── packages/
│   └── shared/       → Общие типы и утилиты
├── nginx/            → Reverse proxy конфиг
└── docker-compose.yml
```

## Быстрый старт (локально)

### 1. Переменные окружения
```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/worker/.env.example apps/worker/.env
# Заполни значения (Telegram Bot Token, OpenAI API Key и т.д.)
```

### 2. База данных + Redis
```bash
docker compose up postgres redis -d
```

### 3. Prisma migrate
```bash
cd apps/api
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Запуск
```bash
# В трёх терминалах:
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
npm run dev --workspace=apps/worker
```

## Деплой (Docker)

```bash
# Создай .env в корне проекта
cat > .env << EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=STRONG_PASSWORD_HERE
POSTGRES_DB=app
VITE_API_URL=https://your-domain.com
DOMAIN=your-domain.com
EOF

# Запусти все сервисы
docker compose up -d --build

# Применить миграции
docker compose exec api npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

### Настройка Telegram Webhook
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/bot/webhook" \
  -d "secret_token=YOUR_WEBHOOK_SECRET"
```

---

## API Reference

### Аутентификация
Все запросы (кроме `/health`) требуют заголовок:
```
x-telegram-init-data: <Telegram WebApp initData>
```
Для разработки: `x-dev-tg-id: <ваш Telegram ID>`

### Формат ответов
**Успех:**
```json
{ "ok": true, "data": ... }
```
**Ошибка:**
```json
{
  "ok": false,
  "code": "validation_error",
  "error": "Invalid request data",
  "details": { "field": ["error message"] }
}
```

### Коды ошибок
| Код | HTTP | Описание |
|-----|------|----------|
| `unauthorized` | 401 | Не авторизован |
| `forbidden` | 403 | Нет доступа |
| `owner_only` | 403 | Только для владельца |
| `not_assignee` | 403 | Только для исполнителя |
| `not_found` | 404 | Ресурс не найден |
| `gone` | 410 | Инвайт истёк |
| `trial_expired` | 402 | Пробный период истёк |
| `validation_error` | 422 | Ошибка валидации |
| `internal_error` | 500 | Внутренняя ошибка |

---

### /me

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/me` | Текущий пользователь |
| GET | `/me/subscription` | Статус подписки |

---

### /focuses (Проекты)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/focuses` | Список проектов |
| POST | `/focuses` | Создать проект |
| GET | `/focuses/:id` | Проект по ID |
| PATCH | `/focuses/:id` | Обновить проект (owner) |
| DELETE | `/focuses/:id` | Удалить проект (owner) |

**POST /focuses — тело запроса:**
```json
{
  "title": "Название проекта",
  "description": "Описание (optional)",
  "stage": "Стадия (optional)",
  "deadline_at": "2025-12-31T00:00:00Z (optional)",
  "success_metric": "Метрика успеха (optional)",
  "budget": 100000,
  "niche": "E-commerce"
}
```

---

### /tasks (Задачи)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/focuses/:id/tasks` | Список задач проекта |
| POST | `/focuses/:id/tasks` | Создать задачу (owner) |
| PATCH | `/tasks/:id` | Обновить задачу |
| DELETE | `/tasks/:id` | Удалить задачу (owner) |
| POST | `/tasks/:id/comments` | Добавить комментарий |

**Query параметры GET /tasks:**
- `assigned=me|all` — фильтр по назначению
- `status=todo|in_progress|done|canceled`
- `priority=low|medium|high|urgent`

**POST /focuses/:id/tasks — тело запроса:**
```json
{
  "title": "Название задачи",
  "description": "Описание",
  "priority": "high",
  "status": "todo",
  "due_at": "2025-06-01T00:00:00Z",
  "assigned_to_user_id": "uuid"
}
```

---

### /invites (Приглашения)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/focuses/:id/invites` | Создать инвайт (owner) |
| POST | `/invites/:code/join` | Войти по инвайту |
| GET | `/focuses/:id/members` | Список участников |

---

### /assistant (ИИ-ассистент)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/focuses/:id/assistant/thread` | История чата |
| POST | `/focuses/:id/assistant/message` | Отправить сообщение |
| POST | `/focuses/:id/assistant/plan_to_tasks` | Конвертировать план ИИ в задачи |

---

## Схема данных

```
User ─────────────────────────────────────────────
  id, tg_id, username, first_name, last_name
  subscription: Subscription
  focuses_owned: Focus[]
  tasks_assigned: Task[]

Focus (Проект) ───────────────────────────────────
  id, title, description, stage
  deadline_at, success_metric, budget, niche
  status: active | paused | archived
  owner: User
  members: FocusMember[]
  tasks: Task[]
  kpis: KPI[]

Task (Задача) ────────────────────────────────────
  id, title, description
  priority: low | medium | high | urgent
  status: todo | in_progress | done | canceled
  due_at: DateTime
  subtasks: SubTask[]
  comments: TaskComment[]
  attachments: TaskAttachment[]
  created_by: User
  assigned_to: User?
```

---

## Worker — Cron Jobs

| Время (UTC) | Описание |
|-------------|----------|
| 9:00 | Напоминания о задачах с дедлайном через N дней |
| 10:00 | Уведомления о просроченных задачах |

Количество дней для напоминания задаётся через `DEADLINE_REMINDER_DAYS` (по умолчанию 1).

---

## Обработка ошибок

Все ошибки обрабатываются централизованно через `globalErrorHandler` в `apps/api/src/lib/errors.ts`:

- **Zod ошибки** → 422 с деталями по полям
- **AppError** → соответствующий HTTP статус
- **Неожиданные ошибки** → 500, логируются + сохраняются в EventLog

На фронтенде `friendlyError()` из `api.ts` конвертирует ошибки в понятные русскоязычные сообщения.
