"""Клиент see.tg (kartoshka.free) — история передач NFT-подарков для режима
«узнать скрытого отправителя» в Gift Watcher.

API: base https://kartoshka.free/v1, токен в query ?token=<app_id>:<secret>.
  • GET /gift/{slug}          → result.estimate.ton   (оценка цены)
  • GET /gift/{slug}/history  → result.items[]         (события, новые первыми)
      событие передачи: giftAction.action == "transfer", с объектами from/to
      (username, telegramId, name).

Лимиты бесплатного тарифа: 1 запрос/сек, 60/мин, 1000/сутки НА КАЖДЫЙ токен.
Соблюдаем:
  • секунду/минуту — единым глобальным троттлингом (мин. интервал между ЛЮБЫМИ
    запросами к see.tg по всему процессу);
  • сутки — РОТАЦИЕЙ нескольких токенов (SEETG_TOKENS): остаток на сегодня по
    каждому токену читаем из заголовка ответа `x-ratelimit-day-remaining` (это
    источник истины сервера, переживает рестарты процесса — раньше свой счётчик
    в памяти сбрасывался при каждом деплое и суммарно уходило больше лимита).
    Токен с исчерпанным дневным лимитом пропускаем до смены суток; когда все
    исчерпаны — _TRANSIENT (вызывающий код НЕ помечает подарок показанным).
"""
from __future__ import annotations

import asyncio
import logging
import time
from urllib.parse import quote

import aiohttp

from app.config import Settings

logger = logging.getLogger(__name__)

import re as _re

_TARGET_DISPLAY_ALIASES: dict[str, frozenset[str]] = {
    "giftstoportals": frozenset({"portal", "gifts to portals", "giftstoportals", "gifts to portal"}),
    "mrktbank": frozenset({"mrkt bank", "mrktbank"}),
    "giftstomarket": frozenset({"gifts to market", "giftstomarket"}),
}

# Промежуточные кошельки/маркеты в цепочке see.tg (hidden name без @).
_MARKET_HOP_NAMES = frozenset(
    {
        "portal",
        "mrkt bank",
        "mrktbank",
        "gifts to portals",
        "gifts to portal",
        "gifts to market",
        "epic gift backpack",
        "tonnel",
        "getgems",
        "you",
    }
)


def _norm_party_name(name: str | None) -> str:
    return (name or "").strip().lower()


def _party_username(party: dict) -> str:
    u = (party.get("username") or "").lstrip("@")
    if u:
        return u
    m = _re.search(r"@([A-Za-z0-9_]{4,32})", party.get("name") or "")
    return m.group(1) if m else ""


def _party_aliases(target: str) -> frozenset[str]:
    base = _TARGET_DISPLAY_ALIASES.get(target, frozenset())
    return base | frozenset({target})


def _is_market_party_name(name: str | None) -> bool:
    pn = _norm_party_name(name)
    if not pn:
        return True
    if pn in _MARKET_HOP_NAMES:
        return True
    for aliases in _TARGET_DISPLAY_ALIASES.values():
        if pn in aliases:
            return True
    return False


def _name_matches_target(party: dict, target: str, target_name: str | None, aliases: frozenset[str]) -> bool:
    pn = _norm_party_name(party.get("name"))
    if not pn:
        return False
    if pn in aliases:
        return True
    if target_name and pn == _norm_party_name(target_name):
        return True
    return False


# 1 запрос/сек по тарифу → держим интервал с запасом. Один общий лок на весь
# процесс: сколько бы групп ни включили режим, суммарно к see.tg идёт не чаще.
_MIN_INTERVAL_SECONDS = 1.2
_lock = asyncio.Lock()
_last_request_at = 0.0

# see.tg отвечает 403 на «пустой» клиентский User-Agent (проверено: голый urllib
# ловит 403, браузерный UA — 200). Ставим явный UA, чтобы не зависеть от дефолта
# aiohttp, если API ужесточит фильтр.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

# Маркер ТРАНЗИЕНТНОЙ ошибки (сеть/таймаут/5xx/429/суточный лимит/нет токена).
# Отличается от None (= see.tg ответил ok:false / нет данных — стабильно):
# транзиентную ошибку вызывающий код повторяет, стабильное «нет данных» — нет.
_TRANSIENT = object()

# Ротация токенов. Каждый токен see.tg — отдельное приложение со своим суточным
# лимитом 1000. Остаток читаем из заголовка ответа `x-ratelimit-day-remaining`.
# ВАЖНО: лимит see.tg — СКОЛЬЗЯЩЕЕ окно 24ч, остаток в течение дня восстанавливается
# (старые запросы выпадают). Поэтому исчерпанный токен блокируем НЕ навечно (и не до
# полуночи), а на _DAY_COOLDOWN — потом пробный запрос подтянет реальный остаток, и
# если окно сдвинулось, токен сам оживёт. Иначе был deadlock: day_remaining застревал
# на ≤reserve, токен переставал опрашиваться → заголовок не приходил → вечная блокировка.
_DAY_RESERVE = 10        # запас до жёсткого 1000, чтобы не ловить 429
_DAY_COOLDOWN = 900.0    # пауза исчерпанного токена (15 мин), затем пробуем снова
_token_state: dict[str, dict] = {}
_rr_index = 0
_day_marker: str | None = None


def _state(token: str) -> dict:
    st = _token_state.get(token)
    if st is None:
        st = {"day_remaining": 1000, "blocked_until": 0.0}
        _token_state[token] = st
    return st


def _maybe_reset_day() -> None:
    """В новые сутки (UTC) полностью размораживаем токены (жёсткий сброс)."""
    global _day_marker
    today = time.strftime("%Y-%m-%d", time.gmtime())
    if today != _day_marker:
        _day_marker = today
        for st in _token_state.values():
            st["day_remaining"] = 1000
            st["blocked_until"] = 0.0


def _pick_token(tokens: list[str]) -> str | None:
    """Round-robin: первый токен не в cooldown. None — если все на паузе.
    Блокировка только по `blocked_until` (а не навечно по day_remaining), чтобы
    исчерпанный токен периодически перепроверялся и оживал при восстановлении окна.
    day_remaining < 0 = безлимит (платный тариф) — всегда годен."""
    global _rr_index
    now = time.monotonic()
    n = len(tokens)
    for i in range(n):
        idx = (_rr_index + i) % n
        tok = tokens[idx]
        if now >= _state(tok)["blocked_until"]:
            _rr_index = (idx + 1) % n
            return tok
    return None


def tokens_exhausted(settings: Settings) -> bool:
    """True, если ВСЕ токены сейчас на паузе (суточный лимит исчерпан по всем).
    Для уведомления владельца/админов, что Gift Watcher see.tg приостановлен."""
    tokens = settings.seetg_tokens
    if not tokens:
        return True
    now = time.monotonic()
    return all(_state(t)["blocked_until"] > now for t in tokens)


def tokens_status_lines(settings: Settings) -> list[str]:
    """Статус каждого токена (app_id, сам токен, остаток, пауза) — ТОЛЬКО для
    админов (в токене секрет, покупателям не показывать)."""
    now = time.monotonic()
    lines = []
    for tok in settings.seetg_tokens:
        st = _state(tok)
        dr = st["day_remaining"]
        paused = int(st["blocked_until"] - now)
        if paused > 0:
            status = f"пауза ещё {paused // 60}м {paused % 60}с"
        else:
            status = "активен"
        app_id = tok.split(":")[0]
        lines.append(f"• app {app_id}: остаток {dr}, {status}\n<code>{tok}</code>")
    return lines


async def _get(settings: Settings, path: str):
    """GET к see.tg с общим троттлингом и ротацией токенов по суточному остатку.

    Возвращает:
      • result (dict)  — успех (ok:true);
      • None           — see.tg ответил, но данных нет (ok:false / битый ответ);
      • _TRANSIENT     — транзиентный сбой (сеть/таймаут/5xx/429/лимит исчерпан на
                         всех токенах/нет токена), запрос стоит повторить позже.
    """
    global _last_request_at
    tokens = settings.seetg_tokens
    if not tokens:
        logger.warning("see.tg: токены не заданы (SEETG_TOKENS/SEETG_TOKEN)")
        return _TRANSIENT
    url = f"{settings.seetg_api_url.rstrip('/')}/{path}"
    data: dict | None = None
    async with _lock:
        _maybe_reset_day()
        attempts = max(len(tokens), 1)
        for _ in range(attempts):
            tok = _pick_token(tokens)
            if tok is None:
                logger.warning("see.tg: суточный лимит исчерпан на всех токенах, пропуск %s", path)
                return _TRANSIENT
            st = _state(tok)
            wait = _MIN_INTERVAL_SECONDS - (time.monotonic() - _last_request_at)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                timeout = aiohttp.ClientTimeout(total=20)
                async with aiohttp.ClientSession(timeout=timeout, headers=_HEADERS) as s:
                    async with s.get(url, params={"token": tok}) as r:
                        dr = r.headers.get("x-ratelimit-day-remaining")
                        if dr is not None:
                            try:
                                st["day_remaining"] = int(dr)
                            except ValueError:
                                pass
                            if 0 <= st["day_remaining"] <= _DAY_RESERVE:
                                st["blocked_until"] = time.monotonic() + _DAY_COOLDOWN
                        data = await r.json(content_type=None)
                        if isinstance(data, dict):
                            _update_billing_headers(st, r.headers, data)
                            billing = data.get("billing")
                            if isinstance(billing, dict) and billing.get("freeRemainingToday") is not None:
                                try:
                                    st["day_remaining"] = int(billing["freeRemainingToday"])
                                except (TypeError, ValueError):
                                    pass
                        if r.status == 429:
                            st["blocked_until"] = time.monotonic() + 60
                            logger.warning("see.tg %s: HTTP 429 (токен %s)", path, tok.split(":")[0])
                            return _TRANSIENT
                        if r.status == 402:
                            st["blocked_until"] = time.monotonic() + _DAY_COOLDOWN
                            logger.warning(
                                "see.tg %s: HTTP 402 (токен %s), пробуем другой ключ",
                                path,
                                tok.split(":")[0],
                            )
                            continue
                        if r.status >= 500:
                            logger.warning("see.tg %s: HTTP %s (транзиентно)", path, r.status)
                            return _TRANSIENT
            except Exception as exc:
                logger.warning("see.tg %s: %s", path, exc)
                return _TRANSIENT
            finally:
                _last_request_at = time.monotonic()
            break
        else:
            return _TRANSIENT
    if not isinstance(data, dict) or not data.get("ok"):
        desc = data.get("description") if isinstance(data, dict) else data
        logger.warning("see.tg %s: не ok (%s)", path, desc)
        return None
    return data.get("result")


async def estimate_ton(settings: Settings, slug: str) -> float | None:
    """Оценочная цена подарка в TON.

    Возвращает:
      • float >= 0 — оценка see.tg;
      • None       — see.tg ответил, но оценки нет (можно пометить показанным);
      • -1.0       — транзиентный сбой see.tg (НЕ помечать показанным, повторить).
    """
    res = await _get(settings, f"gift/{quote(slug, safe='')}")
    if res is _TRANSIENT:
        return -1.0
    if not isinstance(res, dict):
        return None
    est = res.get("estimate")
    val = est.get("ton") if isinstance(est, dict) else None
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


async def last_sender_to(settings: Settings, slug: str, target_username: str) -> dict | None:
    """Отправитель последней реальной передачи подарка на target (маркет)."""
    res = await _get(settings, f"gift/{quote(slug, safe='')}/history")
    if res is _TRANSIENT:
        return _TRANSIENT
    if not isinstance(res, dict):
        return None
    target = (target_username or "").lstrip("@").lower()
    aliases = _party_aliases(target)
    items = res.get("items") or []

    target_id = None
    target_name = None
    for item in items:
        to = (item.get("giftAction") or {}).get("to") or {}
        tu = (to.get("username") or "").lstrip("@").lower()
        if tu == target:
            target_id = target_id or to.get("telegramId")
            target_name = target_name or to.get("name")
        elif _name_matches_target(to, target, target_name, aliases):
            target_name = target_name or to.get("name")
            target_id = target_id or to.get("telegramId")

    def _is_target(party: dict) -> bool:
        pu = (party.get("username") or "").lstrip("@").lower()
        if pu and pu == target:
            return True
        pid = party.get("telegramId")
        if target_id and pid and str(pid) == str(target_id):
            return True
        if target_name and party.get("name") and party.get("name") == target_name:
            return True
        return _name_matches_target(party, target, target_name, aliases)

    def _sender_dict(frm: dict) -> dict | None:
        if _is_target(frm):
            return None
        user = _party_username(frm)
        fid = frm.get("telegramId")
        raw_name = (frm.get("name") or "").strip()
        if user or fid:
            return {"username": user or None, "telegram_id": fid, "name": frm.get("name")}
        if raw_name and not _is_market_party_name(raw_name):
            return {"username": None, "telegram_id": None, "name": raw_name}
        return None

    market_hops: set[str] = set()
    for item in items:
        ga = item.get("giftAction") or {}
        if ga.get("action") != "transfer":
            continue
        to = ga.get("to") or {}
        if not _is_target(to):
            continue
        frm = ga.get("from") or {}
        hit = _sender_dict(frm)
        if hit:
            return hit
        mn = _norm_party_name(frm.get("name"))
        if mn:
            market_hops.add(mn)

    for item in items:
        ga = item.get("giftAction") or {}
        if ga.get("action") != "transfer":
            continue
        to = ga.get("to") or {}
        tn = _norm_party_name(to.get("name"))
        if not tn or tn not in market_hops:
            continue
        hit = _sender_dict(ga.get("from") or {})
        if hit:
            return hit
    return None

# ── Владелец листинга (платная платка): 1× GET /history (бесплатная квота 100/сутки) ──

_LISTING_SEE_MIN_INTERVAL = 10.0
_listing_see_lock = asyncio.Lock()
_listing_see_last_at = 0.0
_request_log: list[tuple[float, str, str]] = []  # (ts, token, path)
_last_limit_alert_at = 0.0
_LIMIT_ALERT_COOLDOWN = 300.0


def _record_request(token: str, path: str) -> None:
    now = time.time()
    _request_log.append((now, token, path))
    cutoff = now - 48 * 3600
    while _request_log and _request_log[0][0] < cutoff:
        _request_log.pop(0)


def request_stats(hours: float = 24.0) -> dict[str, int]:
    cutoff = time.time() - hours * 3600
    per_token: dict[str, int] = {}
    for ts, tok, _ in _request_log:
        if ts >= cutoff:
            app_id = tok.split(":")[0]
            per_token[app_id] = per_token.get(app_id, 0) + 1
    return per_token


def _telegram_party(party: dict | None) -> dict | None:
    if not isinstance(party, dict):
        return None
    username = (party.get("username") or "").lstrip("@") or None
    if not username:
        return None
    tid = party.get("telegramId")
    return {
        "username": username,
        "telegram_id": int(tid) if tid is not None else None,
        "name": party.get("name"),
    }


def _parse_who_result(res: dict) -> dict | None:
    if not isinstance(res, dict):
        return None
    trail = res.get("giftTrail")
    if isinstance(trail, dict):
        party = _telegram_party(trail.get("owner"))
        if party:
            return party
    for key in ("owner", "user"):
        raw = res.get(key)
        party = _telegram_party(raw if isinstance(raw, dict) else None)
        if party:
            return party
    items = res.get("items")
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                party = _telegram_party(item.get("owner"))
                if party:
                    return party
    return _telegram_party(res)


def _owner_from_history(result: dict) -> dict | None:
    """@username из history, если see.tg отдал его явно (часто owner hidden без @)."""
    items = result.get("items") if isinstance(result, dict) else None
    if not isinstance(items, list):
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        ga = item.get("giftAction") or {}
        if not isinstance(ga, dict):
            continue
        action = ga.get("action")
        gift = ga.get("gift") if isinstance(ga.get("gift"), dict) else {}
        if action in ("listing", "price", "delisting", "sale") and gift:
            owner = _telegram_party(gift.get("owner"))
            if owner:
                return owner
    return None


def _listing_event_owner_raw(result: dict) -> dict | None:
    """owner из giftAction listing: имя, @ и telegramId (id нужен, когда маркет скрывает продавца)."""
    items = result.get("items") if isinstance(result, dict) else None
    if not isinstance(items, list):
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        ga = item.get("giftAction") or {}
        if ga.get("action") != "listing":
            continue
        gift = ga.get("gift") if isinstance(ga.get("gift"), dict) else {}
        owner = gift.get("owner") if isinstance(gift, dict) else None
        if isinstance(owner, dict):
            return owner
    return None


def _valid_listing_seller_name(name: str | None) -> bool:
    if not name:
        return False
    s = name.strip()
    return bool(s) and s != "-"


def _merge_listing_owner_name(owner: dict, history_name: str | None) -> dict:
    if not history_name:
        return owner
    merged = dict(owner)
    if not (merged.get("name") or "").strip():
        merged["name"] = history_name
    return merged


def seller_display_names_equal(left: str | None, right: str | None) -> bool:
    """Сверка имён продавца символ в символ (как в карточке TG и see.tg listing)."""
    if left is None or right is None:
        return False
    a, b = left.strip(), right.strip()
    if not a or not b:
        return False
    return a == b


async def _gift_who(settings: Settings, slug: str) -> dict | None | object:
    path = f"gift/{quote(slug, safe='')}/who"
    res = await _get(settings, path)
    if res is _TRANSIENT:
        return _TRANSIENT
    if not isinstance(res, dict):
        return None
    return _parse_who_result(res)


def _update_billing_headers(st: dict, headers, body: dict | None) -> None:
    dr = headers.get("X-Free-Remaining") or headers.get("x-ratelimit-day-remaining")
    if dr is not None:
        try:
            st["day_remaining"] = int(dr)
        except ValueError:
            pass
    billing = (body or {}).get("billing") if isinstance(body, dict) else None
    if isinstance(billing, dict):
        bal = billing.get("balance")
        if bal is not None:
            try:
                st["balance_ton"] = float(bal)
            except (TypeError, ValueError):
                pass
        if billing.get("freeQuota") is False:
            st["paid_method"] = True


async def gift_listing_owner(settings: Settings, slug: str) -> dict | None | object:
    """Продавец лота: только see.tg history (событие listing). Без gift/who."""
    global _listing_see_last_at
    if not slug:
        return None
    if not settings.seetg_tokens:
        logger.warning("see.tg: токены не заданы")
        return _TRANSIENT
    async with _listing_see_lock:
        wait = _LISTING_SEE_MIN_INTERVAL - (time.monotonic() - _listing_see_last_at)
        if wait > 0:
            await asyncio.sleep(wait)
        _listing_see_last_at = time.monotonic()
    path = f"gift/{quote(slug, safe='')}/history"
    res = await _get(settings, path)
    if res is _TRANSIENT:
        return _TRANSIENT
    raw = _listing_event_owner_raw(res) if isinstance(res, dict) else None
    if not isinstance(raw, dict):
        logger.info("see.tg %s: нет события listing", slug)
        return None

    history_name = (raw.get("name") or "").strip()
    if not _valid_listing_seller_name(history_name):
        logger.info("see.tg %s: нет имени в событии listing", slug)
        return None

    tid = raw.get("telegramId")
    telegram_id: int | None = int(tid) if tid is not None else None
    username = (raw.get("username") or "").lstrip("@") or None

    if username:
        party = _telegram_party(raw)
        if not party:
            return {"username": None, "name": history_name, "telegram_id": telegram_id}
        merged = _merge_listing_owner_name(party, history_name)
        see_name = (merged.get("name") or "").strip()
        if see_name and not seller_display_names_equal(history_name, see_name):
            logger.info(
                "see.tg %s: history listing @%s name mismatch %r vs %r",
                slug,
                merged.get("username"),
                history_name,
                see_name,
            )
            return None
        out = dict(merged)
        if telegram_id is not None:
            out["telegram_id"] = telegram_id
        return out
    return {"username": None, "name": history_name, "telegram_id": telegram_id}


async def maybe_notify_seetg_limit(bot, settings: Settings, reason: str, slug: str) -> None:
    global _last_limit_alert_at
    now = time.monotonic()
    if now - _last_limit_alert_at < _LIMIT_ALERT_COOLDOWN:
        return
    _last_limit_alert_at = now
    stats24 = request_stats(24)
    stats48 = request_stats(48)
    lines = [
        "⚠️ <b>see.tg API — лимит / ошибка</b>",
        f"Причина: {reason}",
        f"Лот: <code>{slug}</code>",
        "",
        "<b>Запросы за 24ч:</b>",
    ]
    for app_id, cnt in sorted(stats24.items()):
        lines.append(f"• app {app_id}: {cnt}")
    lines.append("")
    lines.append("<b>Запросы за 48ч:</b>")
    for app_id, cnt in sorted(stats48.items()):
        lines.append(f"• app {app_id}: {cnt}")
    lines.append("")
    for tok in settings.seetg_tokens:
        st = _state(tok)
        bal = st.get("balance_ton", "?")
        dr = st.get("day_remaining", "?")
        lines.append(f"Токен <code>{tok}</code> — free/day {dr}, balance {bal} TON")
    text = "\n".join(lines)
    for aid in settings.admin_ids:
        try:
            await bot.send_message(aid, text, parse_mode="HTML")
        except Exception:
            pass
