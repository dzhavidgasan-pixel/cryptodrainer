from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from collections.abc import Awaitable, Callable
from typing import Any

from telethon import TelegramClient, functions
from telethon.tl import types
from telethon.sessions import StringSession

from app.config import Settings
from app.services.gift_market.demographics import (
    is_arab_seller,
    is_china_seller,
    is_female_seller,
)

logger = logging.getLogger(__name__)

# Юникод-диапазоны характерных для языка систем письма. Строим через chr(),
# а не литеральными символами в исходнике, чтобы не зависеть от кодировки файла.
def _range(start: int, end: int) -> str:
    return f"{chr(start)}-{chr(end)}"


_CYRILLIC = _range(0x0400, 0x04FF)
_ARABIC = _range(0x0600, 0x06FF) + _range(0x0750, 0x077F) + _range(0x08A0, 0x08FF) \
    + _range(0xFB50, 0xFDFF) + _range(0xFE70, 0xFEFE)
_CJK = _range(0x3400, 0x4DBF) + _range(0x4E00, 0x9FFF)

_SCRIPT_PATTERNS: dict[str, re.Pattern[str]] = {
    "ru": re.compile(f"[{_CYRILLIC}]"),
    "ar": re.compile(f"[{_ARABIC}]"),
    "zh": re.compile(f"[{_CJK}]"),
}
_LANG_LABELS = {"ru": "русский", "en": "английский", "ar": "арабский", "zh": "китайский"}
_LATIN_LETTERS = re.compile(r"[A-Za-z]")
_NON_LATIN_SCRIPT = re.compile(f"[{_CYRILLIC}{_ARABIC}{_CJK}]")


def _score_languages(
    name_text: str,
    lang_code: str | None,
    allowed: set[str],
) -> tuple[int, tuple[str, ...]]:
    """Считает очки соответствия каждому разрешённому языку и возвращает лучший результат.

    Сигналы: код языка профиля Telegram (+2) и алфавит, которым написаны
    имя/фамилия/username продавца (+2). Для английского вместо алфавита (латиница
    используется многими языками) берём "чистую латиницу без других систем письма".
    """
    if not allowed:
        return 0, ()

    scores: dict[str, int] = {lang: 0 for lang in allowed}
    reasons: dict[str, list[str]] = {lang: [] for lang in allowed}

    code = (lang_code or "").lower()
    for lang in allowed:
        if code == lang or code.startswith(f"{lang}-"):
            scores[lang] += 2
            reasons[lang].append(f"язык профиля {lang}")

    for lang, pattern in _SCRIPT_PATTERNS.items():
        if lang in allowed and pattern.search(name_text):
            scores[lang] += 2
            reasons[lang].append(f"{_LANG_LABELS[lang]} алфавит в имени")

    if (
        "en" in allowed
        and _LATIN_LETTERS.search(name_text)
        and not _NON_LATIN_SCRIPT.search(name_text)
    ):
        scores["en"] += 2
        reasons["en"].append("латиница в имени")

    best_lang = max(scores, key=lambda lang: scores[lang])
    if scores[best_lang] <= 0:
        return 0, ()
    return scores[best_lang], tuple(reasons[best_lang])


# Backdrop-фонов с "чёрным" в названии несколько (например "Black" и "Onyx Black") —
# это разные, самостоятельные фоны, а не варианты одного и того же. В топик "чёрные
# фоны" должен попадать только фон с точным названием "Black".
_BLACK_BACKDROP_NAME = "black"


def _is_black_backdrop(backdrop: Any) -> bool:
    if backdrop is None:
        return False
    name = (getattr(backdrop, "name", None) or "").strip().lower()
    return name == _BLACK_BACKDROP_NAME


def _amounts_to_price(amounts: Any) -> tuple[int | None, float | None]:
    stars: int | None = None
    ton: float | None = None
    for amount in amounts or []:
        if isinstance(amount, types.StarsAmount):
            stars = amount.amount
        elif isinstance(amount, types.StarsTonAmount):
            ton = amount.amount / 1_000_000_000
    return stars, ton


# Кэш флора — модульного уровня (не на инстанс TelegramGiftMarketClient, тот создаётся
# заново на каждый опрос каждой сессии, раз в GIFT_POLL_INTERVAL_SECONDS), с TTL, общий
# для всех сессий и опросов в процессе. Одни и те же модели встречаются в листингах
# снова и снова — без общего кэша почти на каждый листинг летел бы новый запрос к
# Telegram, и один опрос мог занимать по несколько минут вместо секунд.
# TTL специально небольшой: рынок подарков хайповый, самый дешёвый лот модели может
# быть выкуплен за секунды — старое значение флора быстро становится враньём (баг:
# "флор в несколько раз выше реального"). Плюс самокоррекция вниз в _enrich_listing:
# если среди самих листингов встретился реальный лот дешевле закэшированного флора —
# кэш сразу поправляется, не дожидаясь TTL.
_FLOOR_CACHE_TTL_SECONDS = 60
_floor_price_cache: dict[tuple[int, int], tuple[int | None, float | None, float]] = {}

# Количество подарков на профиле продавца кэшируется по seller_id: за один цикл один
# и тот же продавец встречается по многу лотов, а это отдельный MTProto-запрос —
# без кэша ловили бы flood-wait (см. заметку про скорость парсера).
_GIFTS_COUNT_CACHE_TTL_SECONDS = 300
_gifts_count_cache: dict[int, tuple[int | None, float]] = {}

# Ответы маркета общие для всех групп и всех сессий — это один и тот же публичный
# рынок. Без кэша каждая из групп независимо дёргала GetResaleStarGiftsRequest по
# одним и тем же популярным моделям, и Telegram душил сессии flood wait'ами по 30-40
# секунд — именно отсюда брались многоминутные паузы в листингах. TTL подобран под
# реальность: цикл группы идёт минутами, поэтому 30 секунд схлопывают дубли всех
# девяти групп в один запрос, а задержка появления лота остаётся кратно меньше той,
# что даёт сам flood wait. Ключ — (gift_id, limit): при разном limit ответы разные.
_RESALE_CACHE_TTL_SECONDS = 30
_resale_cache: dict[tuple[int, int], tuple[Any, float]] = {}

# Каталог моделей меняется редко (новые подарки появляются не каждую минуту), а
# запрашивался каждым циклом каждой группы.
_CATALOG_CACHE_TTL_SECONDS = 60
_catalog_cache: tuple[list[Any], float] | None = None


def _prune_cache(cache: dict, ttl: float, now: float) -> None:
    """Чистка протухших ключей, чтобы кэш не рос бесконечно за сутки работы."""
    if len(cache) < 512:
        return
    for key in [k for k, value in cache.items() if now - value[-1] > ttl]:
        cache.pop(key, None)


@dataclass(frozen=True)
class GiftListingData:
    listing_key: str
    gift_id: int | None
    collectible_id: int | None
    slug: str | None
    title: str | None
    model: str | None
    price_stars: int | None
    price_ton: float | None
    # Флор модели — самый дешёвый АКТИВНЫЙ листинг ЭТОЙ ЖЕ модели на маркете прямо
    # сейчас (не цена данного конкретного лота). None, если не удалось получить.
    floor_price_stars: int | None
    floor_price_ton: float | None
    seller_id: int | None
    seller_username: str | None
    seller_name: str | None
    seller_lang_code: str | None
    seller_is_channel: bool
    seller_is_premium: bool | None
    can_write_free: bool | None
    contact_price_stars: int | None
    ru_score: int
    ru_reasons: tuple[str, ...]
    level: int | None  # реальный Stars-уровень аккаунта продавца (не редкость подарка)
    rarity_permille: int | None  # редкость модели в permille (1=0.1%, 10=1%)
    backdrop_name: str | None
    is_black_backdrop: bool
    is_female_seller: bool
    is_china_seller: bool
    is_arab_seller: bool
    seller_last_seen: str | None  # "недавно" / "на этой неделе" / "очень давно" / "в сети был ..." / "в сети сейчас"
    listed_at: datetime
    raw_json: str
    # Сколько подарков на профиле продавца (для строки и фильтра «не больше N»).
    # None — не удалось узнать/не запрашивали.
    gifts_count: int | None = None


def _seller_last_seen_label(status: Any, tzinfo) -> str | None:
    """Переводит статус "был в сети" пользователя Telegram (UserStatus*) в один из
    заранее заданных ярлыков. Не зависит от группы/фильтров — показывается везде,
    кроме Gift Watcher (там нет понятия "продавец")."""
    if status is None or isinstance(status, types.UserStatusEmpty):
        return None
    if isinstance(status, types.UserStatusOnline):
        return "в сети сейчас"
    if isinstance(status, types.UserStatusOffline):
        was_online = getattr(status, "was_online", None)
        if was_online is None:
            return None
        local = was_online.astimezone(tzinfo)
        return f"в сети был {local.strftime('%d.%m.%Y %H:%M')}"
    if isinstance(status, types.UserStatusRecently):
        return "недавно"
    if isinstance(status, types.UserStatusLastWeek):
        return "на этой неделе"
    if isinstance(status, types.UserStatusLastMonth):
        return "очень давно"
    return None


@dataclass(frozen=True)
class SavedGiftData:
    # Составной синтетический ключ (тип/id подарка + отправитель + секунда получения) —
    # у Telegram нет стабильного per-инстанс id для сохранённых подарков (saved_id
    # всегда пустой), см. GiftWatcherSeen в models.py.
    instance_key: str
    gift_title: str | None
    is_unique: bool
    date: datetime
    # Заполняются только для уникальных подарков (StarGiftUnique) — у обычных
    # подарков-стикеров нет модели/фона/узора вообще.
    slug: str | None = None
    model_name: str | None = None
    backdrop_name: str | None = None
    pattern_name: str | None = None
    price_stars: int | None = None
    price_ton: float | None = None
    floor_price_stars: int | None = None
    floor_price_ton: float | None = None
    # Кто передал подарок (Gift Watcher). Берётся из того же ответа GetSavedStarGifts
    # (список users) — без доп. запросов. sender_id=None и sender_username=None, если
    # отправитель скрыл себя (анонимный подарок) — Telegram его не отдаёт вообще.
    sender_id: int | None = None
    sender_username: str | None = None


class TelegramGiftMarketClient:
    def __init__(self, settings: Settings, session_string: str) -> None:
        self._settings = settings
        self._session_string = session_string
        # кэш результата live-проверки платных сообщений на один запуск fetch_latest_listings,
        # чтобы не дёргать GetRequirementsToContactRequest повторно для одного и того же продавца
        self._contact_requirement_cache: dict[int, tuple[bool, int | None]] = {}
        # кэш объекта UserFull целиком на один запуск fetch_latest_listings — источник
        # Stars-уровня продавца, чтобы не дёргать GetFullUserRequest дважды на одного
        # и того же продавца.
        self._full_user_cache: dict[int, Any] = {}
        # Полное обогащение профиля продавца по @ за один опрос на seller_id — один и
        # тот же человек может быть в десятках лотов; enrich_listing_seller_profile
        # делает get_entity + GetSavedStarGifts и т.д., без кэша ловим flood wait.
        self._enrich_profile_cache: dict[int, GiftListingData] = {}

    @asynccontextmanager
    async def _connected_client(self):
        """Явное подключение вместо `async with TelegramClient(...)`: последний неявно
        вызывает `.start()`, а если сессия отозвана (разлогинена со стороны Telegram),
        `.start()` пытается запросить телефон через блокирующий `input()`. Под systemd
        (без stdin) это валится с EOFError — но уже ПОСЛЕ того, как соединение открыто,
        а т.к. `__aenter__` падает, `__aexit__`/disconnect() никогда не вызывается: связка
        и фоновые задачи Telethon повисают навсегда. При повторе на каждом опросе (раз в
        GIFT_POLL_INTERVAL_SECONDS) эти утечки копятся и в итоге замораживают весь процесс
        опроса рынка (и обе группы листингов сразу, т.к. воркер один на всех).
        Здесь вместо этого сами коннектимся и проверяем авторизацию, чтобы гарантированно
        не трогать input() и всегда закрывать соединение."""
        client = TelegramClient(
            StringSession(self._session_string),
            self._settings.telegram_api_id,
            self._settings.telegram_api_hash,
            # Короткие flood-wait (<=10 сек) Telethon пусть переждёт сам, а длинные
            # (30-120 сек — раньше он молча их «спал», отсюда простои по 1-2 минуты
            # у всей группы) — сразу поднимаем как ошибку: сессия пропускается на этот
            # цикл, её часть каталога подхватит следующий проход или другая сессия,
            # без заморозки всего опроса.
            flood_sleep_threshold=10,
        )
        await client.connect()
        try:
            if not await client.is_user_authorized():
                raise RuntimeError(
                    "Сессия не авторизована в Telegram (отозвана или разлогинена вручную)"
                )
            yield client
        finally:
            # После сетевого сбоя (обрыв/потеря пакетов) соединение может оказаться
            # "полуживым": сам disconnect() ждёт ответа от мёртвого сокета и виснет
            # без ошибки — тогда внешний asyncio.wait_for в listings.py не спасает,
            # т.к. ждёт завершения именно ЭТОЙ очистки при отмене. Поэтому у самого
            # disconnect() тоже есть жёсткий потолок по времени.
            try:
                await asyncio.wait_for(client.disconnect(), timeout=10)
            except Exception:
                logger.warning("Cannot cleanly disconnect Telegram client, ignoring")

    async def fetch_latest_listings(
        self,
        shard_index: int = 0,
        shard_count: int = 1,
        base_limit: int | None = None,
        resale_limit_per_gift: int | None = None,
        catalog_offset: int = 0,
        pre_filter: Callable[[GiftListingData], Awaitable[bool]] | None = None,
    ) -> tuple[list[GiftListingData], int]:
        """Тянет листинги. При shard_count > 1 обрабатывает только свою часть каталога
        (round-robin по индексу), чтобы при нескольких сессиях нагрузка на каждый
        аккаунт была меньше и flood wait ловился реже.

        base_limit/resale_limit_per_gift — раньше были глобальными настройками
        (.env), теперь настраиваются per-group (TrackerGroup.gift_base_limit/
        gift_resale_limit_per_gift); если не переданы явно — берём старые
        глобальные значения из settings как запасной вариант.

        catalog_offset — с какой позиции в общем каталоге брать окно шириной
        base_limit (с закольцовыванием на начало). Раньше окно всегда было
        catalog[:base_limit], поэтому модели ПОСЛЕ этого среза (обычно самые
        дорогие и редкие) не проверялись никогда, сколько бы ни ждали. Теперь
        окно сдвигается на base_limit с каждым опросом — возвращаем ещё и
        next_offset, чтобы вызывающий код сохранил его для следующего опроса
        этой же группы.

        pre_filter — дешёвая проверка (без единого запроса к Telegram), которой
        вызывающий код отсеивает заведомо ненужные лоты ДО обогащения. Без него
        бот платил 2-3 запроса за каждого продавца, которого потом всё равно
        выбрасывал фильтр, а лимит gift_max_listings_per_poll съедался этим же
        отсевом — из-за чего цикл шёл минутами и в группу прилетали редкие пачки
        вместо ровного потока."""
        base_limit = base_limit if base_limit is not None else self._settings.gift_base_limit
        resale_limit_per_gift = (
            resale_limit_per_gift if resale_limit_per_gift is not None else self._settings.gift_resale_limit_per_gift
        )
        async with self._connected_client() as client:
            all_gifts = await self._fetch_catalog(client)
            total = len(all_gifts)
            if total == 0:
                return [], 0

            window = min(base_limit, total)
            start = catalog_offset % total
            end = start + window
            if end <= total:
                gifts = all_gifts[start:end]
            else:
                gifts = all_gifts[start:] + all_gifts[: end - total]
            next_offset = end % total

            if shard_count > 1:
                gifts = gifts[shard_index::shard_count]

            listings: list[GiftListingData] = []
            # Раньше шли подарки по очереди: первый в окне каталога с сотнями лотов в
            # ресейле (Moon Pendant) забирал весь gift_max_listings_per_poll — в ленту
            # почти не попадали остальные модели. Берём по ОДНОМУ кандидату с каждого
            # подарка в окне, раунд-робином, пока не наберём лимит.
            gift_batches: list[dict[str, Any]] = []
            for gift in gifts:
                resale = await self._fetch_resale(client, gift.id, resale_limit_per_gift)
                if resale is None:
                    continue
                users_by_id = {
                    getattr(user, "id", None): user for user in getattr(resale, "users", [])
                }
                chats_by_id = {
                    getattr(chat, "id", None): chat for chat in getattr(resale, "chats", [])
                }
                items_ready: list[tuple[GiftListingData, int | None]] = []
                for item in getattr(resale, "gifts", []):
                    stub, model_document_id = self._build_listing_stub(
                        item, users_by_id, chats_by_id, gift.id
                    )
                    if pre_filter is not None and not await pre_filter(stub):
                        continue
                    items_ready.append((stub, model_document_id))
                if items_ready:
                    gift_batches.append(
                        {
                            "gift_id": gift.id,
                            "users": users_by_id,
                            "chats": chats_by_id,
                            "items": items_ready,
                        }
                    )

            round_idx = 0
            while True:
                progressed = False
                for batch in gift_batches:
                    if len(listings) >= self._settings.gift_max_listings_per_poll:
                        return listings, next_offset
                    if round_idx >= len(batch["items"]):
                        continue
                    progressed = True
                    stub, model_document_id = batch["items"][round_idx]
                    listings.append(
                        await self._enrich_listing(
                            client, stub, batch["users"], batch["gift_id"], model_document_id
                        )
                    )
                if not progressed:
                    break
                round_idx += 1

            return listings, next_offset

    async def fetch_catalog_gifts(self) -> list[tuple[int, str]]:
        """(gift_id, название) всех подарков, которые сейчас торгуются на маркете —
        для выбора подарка под отдельный топик. Список живой: новый подарок попадает
        сюда сам, как только Telegram отдаёт его в каталоге, вести его руками не надо."""
        async with self._connected_client() as client:
            gifts = await self._fetch_catalog(client)
        return [
            (gift.id, gift.title)
            for gift in gifts
            if getattr(gift, "id", None) and getattr(gift, "title", None)
        ]

    async def lookup_username(self, seller_id: int) -> str | None:
        """@username по telegram id — когда в листинге есть seller_id, но нет @."""
        try:
            async with self._connected_client() as client:
                ent = await client.get_entity(seller_id)
                un = getattr(ent, "username", None) or _first_active_username(ent)
                return (un or "").lstrip("@") or None
        except Exception as exc:
            logger.warning("Cannot resolve username for seller id %s: %s", seller_id, exc)
            return None

    async def enrich_listing_seller_profile(self, listing: GiftListingData) -> GiftListingData:
        """После see.tg: уровень, платные сообщения, RU-score и пр. по @username."""
        if not listing.seller_username:
            return listing
        sid = listing.seller_id
        if sid is not None and sid in self._enrich_profile_cache:
            cached = self._enrich_profile_cache[sid]
            return replace(
                listing,
                seller_id=cached.seller_id,
                seller_name=cached.seller_name,
                seller_lang_code=cached.seller_lang_code,
                seller_is_premium=cached.seller_is_premium,
                can_write_free=cached.can_write_free,
                contact_price_stars=cached.contact_price_stars,
                ru_score=cached.ru_score,
                ru_reasons=cached.ru_reasons,
                level=None,
                gifts_count=None,
                seller_last_seen=cached.seller_last_seen,
                is_female_seller=cached.is_female_seller,
                is_china_seller=cached.is_china_seller,
                is_arab_seller=cached.is_arab_seller,
            )
        try:
            async with self._connected_client() as client:
                ent = await client.get_entity(listing.seller_username)
                seller_id = getattr(ent, "id", None) or listing.seller_id
                seller_name = _display_name(ent) or listing.seller_name
                lang = getattr(ent, "lang_code", None) or listing.seller_lang_code
                premium = getattr(ent, "premium", listing.seller_is_premium)
                paid_stars = getattr(ent, "send_paid_messages_stars", None)
                can_write_free = listing.can_write_free
                contact_price_stars = listing.contact_price_stars
                if paid_stars is not None:
                    can_write_free = not bool(paid_stars)
                    contact_price_stars = paid_stars or None
                if self._settings.gift_check_contact_requirements:
                    live = await self._check_contact_requirement(client, ent)
                    if live is not None:
                        can_write_free, contact_price_stars = live
                name_text = " ".join(
                    part
                    for part in (
                        getattr(ent, "first_name", None),
                        getattr(ent, "last_name", None),
                        listing.seller_username,
                    )
                    if part
                )
                ru_score, ru_reasons = _score_languages(
                    name_text, lang, self._settings.gift_allowed_languages
                )
                seller_last_seen = (
                    None
                    if self._settings.gift_listing_compact_message
                    else _seller_last_seen_label(
                        getattr(ent, "status", None), self._settings.tzinfo
                    )
                )
                out = replace(
                    listing,
                    seller_id=seller_id,
                    seller_name=seller_name,
                    seller_lang_code=lang,
                    seller_is_premium=premium,
                    can_write_free=can_write_free,
                    contact_price_stars=contact_price_stars,
                    ru_score=ru_score,
                    ru_reasons=ru_reasons,
                    level=None,
                    gifts_count=None,
                    seller_last_seen=seller_last_seen,
                    is_female_seller=is_female_seller(seller_name, listing.seller_username),
                    is_china_seller=is_china_seller(seller_name, listing.seller_username, lang),
                    is_arab_seller=is_arab_seller(seller_name, listing.seller_username, lang),
                )
                if seller_id is not None:
                    self._enrich_profile_cache[seller_id] = out
                return out
        except Exception as exc:
            logger.warning("Cannot enrich seller @%s: %s", listing.seller_username, exc)
            return listing

    async def fetch_user_level_and_gifts(self, username_or_id) -> tuple[int | None, int | None]:
        """(Stars level, число коллекционных подарков) в профиле пользователя по
        @username или id. Для фильтров Gift Watcher ПО ОТПРАВИТЕЛЮ подарка.
        (None, None) при ошибке резолва/приватности — вызывающий такой фильтр не
        применяет (лот не режется, если отправителя не удалось проверить)."""
        try:
            async with self._connected_client() as client:
                ent = await client.get_entity(username_or_id)
                level = await self._fetch_user_level(client, ent)
                gifts_count = await self._fetch_seller_gifts_count(client, ent)
                return level, gifts_count
        except Exception as exc:
            logger.warning("Cannot fetch sender level/gifts for %s: %s", username_or_id, exc)
            return None, None

    async def fetch_saved_gifts(self, username: str, limit: int = 30) -> list[SavedGiftData]:
        """Подарки на публичном профиле указанного юзернейма (Gift Watcher). Работает
        для любого профиля, не только контактов — если владелец скрыл список подарков
        в настройках приватности, Telegram просто вернёт пустой список, как и для
        любого стороннего наблюдателя в приложении; это не обходится и не должно."""
        async with self._connected_client() as client:
            peer = await client.get_entity(username)
            result = await client(
                functions.payments.GetSavedStarGiftsRequest(peer=peer, offset="", limit=limit)
            )
            # username-ы отправителей приходят в том же ответе (result.users) — резолвить
            # по id отдельным запросом не нужно (и ненадёжно без access_hash).
            users_by_id = {u.id: u for u in getattr(result, "users", [])}
            gifts: list[SavedGiftData] = []
            for item in getattr(result, "gifts", []):
                gift_obj = getattr(item, "gift", None)
                date = getattr(item, "date", None) or datetime.now(timezone.utc)
                gift_ref = getattr(gift_obj, "slug", None) or getattr(gift_obj, "id", None) or "unknown"
                from_id = getattr(item, "from_id", None)
                sender_id = getattr(from_id, "user_id", None) if from_id is not None else None
                from_ref = sender_id or getattr(from_id, "channel_id", None) or "anon"
                sender_user = users_by_id.get(sender_id) if sender_id is not None else None
                sender_username = getattr(sender_user, "username", None) if sender_user is not None else None
                instance_key = f"{gift_ref}:{from_ref}:{int(date.timestamp())}"

                is_unique = isinstance(gift_obj, types.StarGiftUnique)
                slug = model_name = backdrop_name = pattern_name = None
                price_stars = price_ton = floor_price_stars = floor_price_ton = None

                if is_unique:
                    slug = getattr(gift_obj, "slug", None)
                    attributes = getattr(gift_obj, "attributes", None) or []
                    model_attr = next(
                        (a for a in attributes if isinstance(a, types.StarGiftAttributeModel)), None
                    )
                    backdrop_attr = next(
                        (a for a in attributes if isinstance(a, types.StarGiftAttributeBackdrop)), None
                    )
                    pattern_attr = next(
                        (a for a in attributes if isinstance(a, types.StarGiftAttributePattern)), None
                    )
                    model_name = getattr(model_attr, "name", None)
                    backdrop_name = getattr(backdrop_attr, "name", None)
                    pattern_name = getattr(pattern_attr, "name", None)
                    price_stars, price_ton = _amounts_to_price(getattr(gift_obj, "resell_amount", None))

                    gift_id = getattr(gift_obj, "gift_id", None)
                    document_id = getattr(getattr(model_attr, "document", None), "id", None)
                    if gift_id is not None and document_id is not None:
                        floor_price_stars, floor_price_ton = await self._fetch_model_floor(
                            client, gift_id, document_id
                        )

                gifts.append(
                    SavedGiftData(
                        instance_key=instance_key,
                        gift_title=getattr(gift_obj, "title", None),
                        is_unique=is_unique,
                        date=date,
                        slug=slug,
                        model_name=model_name,
                        backdrop_name=backdrop_name,
                        pattern_name=pattern_name,
                        price_stars=price_stars,
                        price_ton=price_ton,
                        floor_price_stars=floor_price_stars,
                        floor_price_ton=floor_price_ton,
                        sender_id=sender_id,
                        sender_username=sender_username,
                    )
                )
            return gifts

    async def fetch_self_info(self) -> tuple[str, int]:
        """Возвращает (имя, telegram id) аккаунта этой сессии — для стартового сообщения."""
        async with self._connected_client() as client:
            me = await client.get_me()
            name = (
                " ".join(part for part in (me.first_name, me.last_name) if part)
                or (me.username and f"@{me.username}")
                or str(me.id)
            )
            return name, me.id

    async def fetch_catalog_titles(self) -> list[str]:
        """Названия подарков, которые сейчас доступны к отслеживанию (для стартового сообщения)."""
        async with self._connected_client() as client:
            gifts_response = await client(functions.payments.GetStarGiftsRequest(hash=0))
            titles = [
                gift.title
                for gift in getattr(gifts_response, "gifts", [])
                if (
                    getattr(gift, "availability_resale", None)
                    or getattr(gift, "resell_min_stars", None)
                )
                and getattr(gift, "title", None)
            ]
            return titles[: self._settings.gift_base_limit]

    async def _fetch_catalog(self, client: TelegramClient) -> list[Any]:
        """Каталог моделей с активным ресейлом. Кэш общий на процесс: каталог один и
        тот же для всех групп и сессий, а запрашивался каждым циклом заново."""
        global _catalog_cache
        now = time.monotonic()
        if _catalog_cache is not None and now - _catalog_cache[1] < _CATALOG_CACHE_TTL_SECONDS:
            return _catalog_cache[0]

        gifts_response = await client(functions.payments.GetStarGiftsRequest(hash=0))
        all_gifts = [
            gift
            for gift in getattr(gifts_response, "gifts", [])
            if getattr(gift, "availability_resale", None)
            or getattr(gift, "resell_min_stars", None)
        ]
        _catalog_cache = (all_gifts, now)
        return all_gifts

    async def _fetch_resale(self, client: TelegramClient, gift_id: int, limit: int) -> Any | None:
        """Лоты одной модели. Кэш общий на процесс (см. _resale_cache) — иначе каждая
        группа платит собственным запросом за одни и те же популярные модели, а сессии
        за это получают flood wait."""
        now = time.monotonic()
        cache_key = (gift_id, limit)
        cached = _resale_cache.get(cache_key)
        if cached is not None and now - cached[1] < _RESALE_CACHE_TTL_SECONDS:
            return cached[0]

        try:
            resale = await client(
                functions.payments.GetResaleStarGiftsRequest(
                    gift_id=gift_id,
                    offset="",
                    limit=limit,
                    sort_by_price=False,
                    sort_by_num=False,
                    attributes_hash=0,
                    attributes=[],
                )
            )
        except Exception as exc:
            logger.warning("Cannot fetch resale gifts for %s: %s", gift_id, exc)
            return None

        _prune_cache(_resale_cache, _RESALE_CACHE_TTL_SECONDS, now)
        _resale_cache[cache_key] = (resale, now)
        return resale

    def _build_listing_stub(
        self,
        item: Any,
        users_by_id: dict[int | None, Any],
        chats_by_id: dict[int | None, Any],
        gift_id: int,
    ) -> tuple[GiftListingData, int | None]:
        """Собирает лот ТОЛЬКО из данных, которые уже пришли вместе с ответом маркета —
        ни одного запроса к Telegram. @продавца на маркете Telegram не отдаёт — для
        поста в группу username подставляется позже через see.tg gift/who. Здесь
        seller_username из users[] может быть пустым даже при валидном лоте. Флор/
        уровень/контакт-реквизиты дозаполняет _enrich_listing. Вторым значением —
        document_id модели для запроса флора."""
        attributes = getattr(item, "attributes", None) or []
        model_attr = next(
            (attr for attr in attributes if isinstance(attr, types.StarGiftAttributeModel)),
            None,
        )
        model_name = model_attr.name if model_attr is not None else None
        rarity_permille: int | None = None
        if model_attr is not None and isinstance(model_attr.rarity, types.StarGiftAttributeRarity):
            rarity_permille = model_attr.rarity.permille

        backdrop_attr = next(
            (attr for attr in attributes if isinstance(attr, types.StarGiftAttributeBackdrop)),
            None,
        )
        backdrop_name = getattr(backdrop_attr, "name", None)
        is_black_backdrop = _is_black_backdrop(backdrop_attr)

        price_stars, price_ton = _amounts_to_price(getattr(item, "resell_amount", None))

        model_document_id: int | None = None
        if model_attr is not None:
            model_document_id = getattr(getattr(model_attr, "document", None), "id", None)

        owner = getattr(item, "owner_id", None)
        seller_id: int | None = None
        seller_username: str | None = None
        seller_name: str | None = None
        seller_lang_code: str | None = None
        seller_is_channel = False
        seller_is_premium: bool | None = None
        can_write_free: bool | None = None
        contact_price_stars: int | None = None

        user_obj = None
        channel_obj = None
        if isinstance(owner, types.PeerUser):
            seller_id = owner.user_id
            user_obj = users_by_id.get(owner.user_id)
        elif isinstance(owner, types.PeerChannel):
            seller_id = owner.channel_id
            seller_is_channel = True
            channel_obj = chats_by_id.get(owner.channel_id)
            if channel_obj is not None:
                seller_username = getattr(channel_obj, "username", None)
                seller_name = getattr(channel_obj, "title", None)
        elif isinstance(owner, dict):
            # Редко owner_id приходит как dict (например, после сериализации в to_dict).
            uid = owner.get("user_id")
            cid = owner.get("channel_id")
            if uid is not None:
                try:
                    seller_id = int(uid)
                except (TypeError, ValueError):
                    seller_id = None
                else:
                    user_obj = users_by_id.get(seller_id)
            elif cid is not None:
                try:
                    seller_id = int(cid)
                except (TypeError, ValueError):
                    seller_id = None
                else:
                    seller_is_channel = True
                    channel_obj = chats_by_id.get(seller_id)
                    if channel_obj is not None:
                        seller_username = getattr(channel_obj, "username", None)
                        seller_name = getattr(channel_obj, "title", None)

        if user_obj is not None:
            seller_username = getattr(user_obj, "username", None) or _first_active_username(user_obj)
            seller_name = _display_name(user_obj)
            seller_lang_code = getattr(user_obj, "lang_code", None)
            seller_is_premium = getattr(user_obj, "premium", None)

            paid_stars = getattr(user_obj, "send_paid_messages_stars", None)
            can_write_free = not bool(paid_stars)
            contact_price_stars = paid_stars or None
        else:
            # У resale Telegram часто скрывает PeerUser (owner_id=None), но оставляет owner_name.
            raw_owner_name = getattr(item, "owner_name", None)
            if isinstance(raw_owner_name, str):
                stripped = raw_owner_name.strip()
                if stripped:
                    seller_name = stripped

        seller_last_seen: str | None = None
        if user_obj is not None:
            seller_last_seen = _seller_last_seen_label(getattr(user_obj, "status", None), self._settings.tzinfo)

        name_text_parts: list[str | None] = [
            getattr(user_obj, "first_name", None) if user_obj else None,
            getattr(user_obj, "last_name", None) if user_obj else None,
            seller_username,
        ]
        if user_obj is None and seller_name:
            name_text_parts.append(seller_name)
        name_text = " ".join(part for part in name_text_parts if part)
        ru_score, ru_reasons = _score_languages(
            name_text, seller_lang_code, self._settings.gift_allowed_languages
        )

        listing_key = str(getattr(item, "id", None) or getattr(item, "slug", None) or id(item))

        stub = GiftListingData(
            listing_key=listing_key,
            gift_id=getattr(item, "gift_id", None),
            collectible_id=getattr(item, "id", None),
            slug=getattr(item, "slug", None),
            title=getattr(item, "title", None),
            model=model_name,
            price_stars=price_stars,
            price_ton=price_ton,
            floor_price_stars=None,
            floor_price_ton=None,
            seller_id=seller_id,
            seller_username=seller_username,
            seller_name=seller_name,
            seller_lang_code=seller_lang_code,
            seller_is_channel=seller_is_channel,
            seller_is_premium=seller_is_premium,
            can_write_free=can_write_free,
            contact_price_stars=contact_price_stars,
            ru_score=ru_score,
            ru_reasons=ru_reasons,
            level=None,
            rarity_permille=rarity_permille,
            backdrop_name=backdrop_name,
            is_black_backdrop=is_black_backdrop,
            is_female_seller=is_female_seller(seller_name, seller_username),
            is_china_seller=is_china_seller(seller_name, seller_username, seller_lang_code),
            is_arab_seller=is_arab_seller(seller_name, seller_username, seller_lang_code),
            seller_last_seen=seller_last_seen,
            listed_at=datetime.now(timezone.utc),
            raw_json=json.dumps(item.to_dict(), default=str, ensure_ascii=False),
        )
        return stub, model_document_id

    async def _enrich_listing(
        self,
        client: TelegramClient,
        stub: GiftListingData,
        users_by_id: dict[int | None, Any],
        gift_id: int,
        model_document_id: int | None,
    ) -> GiftListingData:
        """Дозаполняет то, за что нужно платить отдельными запросами к Telegram:
        флор модели, Stars-уровень продавца и (если включён
        GIFT_CHECK_CONTACT_REQUIREMENTS) точные контакт-реквизиты. Вызывается ТОЛЬКО
        для лотов, уже прошедших дешёвый предфильтр — иначе мы платили бы по 2-3
        запроса за каждого продавца, которого потом всё равно выбрасываем."""
        floor_price_stars: int | None = None
        floor_price_ton: float | None = None
        if model_document_id is not None:
            floor_price_stars, floor_price_ton = await self._fetch_model_floor(
                client, gift_id, model_document_id
            )
            # Самокоррекция ВНИЗ: если флор ИЗВЕСТЕН, но этот лот дешевле его (рынок
            # хайповый, самый дешёвый лот модели мог исчезнуть за секунды) — правим
            # кэш немедленно. НО если флор неизвестен (запрос не удался) — НЕ выдаём
            # цену этого лота за флор: для тролль-лота (дешёвую модель выставили
            # втридорога) это показало бы завышенный флор и затащило бы его в дорогие.
            # Оставляем флор пустым → в сообщении "Флор: неизвестно".
            if (
                stub.price_ton is not None
                and floor_price_ton is not None
                and stub.price_ton < floor_price_ton
            ):
                floor_price_stars, floor_price_ton = stub.price_stars, stub.price_ton
                _floor_price_cache[(gift_id, model_document_id)] = (
                    stub.price_stars,
                    stub.price_ton,
                    time.monotonic(),
                )

        user_obj = users_by_id.get(stub.seller_id) if not stub.seller_is_channel else None

        can_write_free = stub.can_write_free
        contact_price_stars = stub.contact_price_stars
        if user_obj is not None and self._settings.gift_check_contact_requirements:
            live = await self._check_contact_requirement(client, user_obj)
            if live is not None:
                can_write_free, contact_price_stars = live

        return replace(
            stub,
            floor_price_stars=floor_price_stars,
            floor_price_ton=floor_price_ton,
            can_write_free=can_write_free,
            contact_price_stars=contact_price_stars,
            level=None,
            gifts_count=None,
        )

    async def _fetch_seller_gifts_count(self, client: TelegramClient, user_obj: Any) -> int | None:
        """Сколько подарков на профиле продавца. Отдельный MTProto-запрос, поэтому
        кэшируется по seller_id с TTL. Если профиль скрыт/ошибка — возвращаем None
        (в сообщении будет «неизвестно», фильтр по количеству такой лот не режет)."""
        seller_id = getattr(user_obj, "id", None)
        if seller_id is None:
            return None
        now = time.monotonic()
        cached = _gifts_count_cache.get(seller_id)
        if cached is not None and now - cached[1] < _GIFTS_COUNT_CACHE_TTL_SECONDS:
            return cached[0]
        count: int | None = None
        try:
            result = await client(
                functions.payments.GetSavedStarGiftsRequest(peer=user_obj, offset="", limit=100)
            )
            gifts = getattr(result, "gifts", []) or []
            # Считаем ТОЛЬКО коллекционные (улучшенные, StarGiftUnique) подарки —
            # обычные подарки-стикеры (которые нельзя улучшить) не учитываем.
            count = sum(
                1 for it in gifts if isinstance(getattr(it, "gift", None), types.StarGiftUnique)
            )
        except Exception:
            count = None
        _gifts_count_cache[seller_id] = (count, now)
        return count

    async def _fetch_model_floor(
        self, client: TelegramClient, gift_id: int, model_document_id: int
    ) -> tuple[int | None, float | None]:
        """Самый дешёвый активный листинг ИМЕННО этой модели на маркете прямо сейчас
        (флор), а не цена конкретного лота. Тем же официальным методом Telegram,
        которым берём сами листинги — с фильтром по модели и сортировкой по цене.
        Кэш общий для процесса (см. _floor_price_cache) с TTL в _FLOOR_CACHE_TTL_SECONDS."""
        cache_key = (gift_id, model_document_id)
        cached = _floor_price_cache.get(cache_key)
        now = time.monotonic()
        if cached is not None and now - cached[2] < _FLOOR_CACHE_TTL_SECONDS:
            return cached[0], cached[1]

        stars: int | None = None
        ton: float | None = None
        try:
            resale = await client(
                functions.payments.GetResaleStarGiftsRequest(
                    gift_id=gift_id,
                    offset="",
                    limit=1,
                    sort_by_price=True,
                    sort_by_num=False,
                    attributes_hash=0,
                    attributes=[types.StarGiftAttributeIdModel(document_id=model_document_id)],
                )
            )
            items = getattr(resale, "gifts", None) or []
            if items:
                stars, ton = _amounts_to_price(getattr(items[0], "resell_amount", None))
        except Exception as exc:
            logger.warning(
                "Cannot fetch floor price for gift %s model doc %s: %s",
                gift_id,
                model_document_id,
                exc,
            )

        # Кэшируем ТОЛЬКО реально полученный флор. Если запрос упал (flood/ошибка)
        # или маркет вернул пусто (ton is None) — не кэшируем неудачу: иначе она
        # заморозила бы "флор неизвестен" на весь TTL, и все лоты этой модели весь
        # период показывали бы флор = собственной цене (тролль-лот выглядел бы как
        # честный). Не кэшируя, на следующем цикле пробуем достать флор заново.
        if ton is not None:
            _floor_price_cache[cache_key] = (stars, ton, now)
        return stars, ton

    async def _fetch_full_user(self, client: TelegramClient, user_obj: Any) -> Any | None:
        """UserFull целиком, закэшированный на один запуск fetch_latest_listings —
        источник Stars-уровня (_fetch_user_level), чтобы не дёргать GetFullUserRequest
        дважды на одного и того же продавца."""
        if user_obj.id in self._full_user_cache:
            return self._full_user_cache[user_obj.id]
        # Передаём сам user_obj, а НЕ собранный вручную InputUser с
        # `access_hash or 0`: у продавцов из ответа маркета access_hash часто
        # отсутствует, и с access_hash=0 GetFullUser возвращает урезанного юзера
        # без stars_rating → уровень выходил None (в сообщении 0) и фильтр по
        # уровню пропускал крупные аккаунты. С самим user_obj Telethon берёт
        # корректный input entity — так же, как рабочий GetSavedStarGifts(peer=user_obj).
        try:
            full = await client(functions.users.GetFullUserRequest(id=user_obj))
        except Exception as exc:
            logger.warning("Cannot fetch full user (%s): %s", getattr(user_obj, "id", "?"), exc)
            full = None
        full_user = getattr(full, "full_user", None)
        self._full_user_cache[user_obj.id] = full_user
        return full_user

    async def _fetch_user_level(self, client: TelegramClient, user_obj: Any) -> int | None:
        """Реальный уровень аккаунта продавца (Telegram Stars level: диапазон примерно
        от отрицательных значений и 0 до 99), а не редкость модели подарка.
        Берётся из UserFull.stars_rating.level через users.getFullUser."""
        full_user = await self._fetch_full_user(client, user_obj)
        rating = getattr(full_user, "stars_rating", None)
        return getattr(rating, "level", None)


    async def _check_contact_requirement(
        self, client: TelegramClient, user_obj: Any
    ) -> tuple[bool, int | None] | None:
        """Живая проверка через GetRequirementsToContactRequest (точнее, но лишний запрос к API)."""
        cached = self._contact_requirement_cache.get(user_obj.id)
        if cached is not None:
            return cached
        try:
            # get_input_entity, а не ручной InputUser с `access_hash or 0`: иначе
            # у продавцов из ответа маркета без access_hash запрос идёт с нулевым
            # хэшем и возвращает мусор (тот же класс бага, что был у уровня).
            input_user = await client.get_input_entity(user_obj)
            result = await client(
                functions.users.GetRequirementsToContactRequest(id=[input_user])
            )
        except Exception as exc:
            logger.warning("Cannot check contact requirements for %s: %s", user_obj.id, exc)
            return None
        if not result:
            return None

        requirement = result[0]
        if isinstance(requirement, types.RequirementToContactPaidMessages):
            value = (False, requirement.stars_amount)
        else:
            # RequirementToContactEmpty (бесплатно) или RequirementToContactPremium
            # (нужен Premium у отправителя, но не платные звёзды) — считаем «бесплатно».
            value = (True, None)
        self._contact_requirement_cache[user_obj.id] = value
        return value


def _display_name(user_obj: Any) -> str | None:
    name = " ".join(
        part
        for part in (getattr(user_obj, "first_name", None), getattr(user_obj, "last_name", None))
        if part
    )
    return name or None


def _first_active_username(user_obj: Any) -> str | None:
    for entry in getattr(user_obj, "usernames", None) or []:
        if getattr(entry, "active", True):
            return getattr(entry, "username", None)
    return None
