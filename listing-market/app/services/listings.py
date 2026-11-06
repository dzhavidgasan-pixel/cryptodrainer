import asyncio
import html
import logging
from dataclasses import dataclass, replace
from datetime import datetime

from aiogram import Bot
from aiogram.enums import ButtonStyle
from aiogram.exceptions import TelegramBadRequest, TelegramRetryAfter
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from telethon import errors as telethon_errors

from app.config import Settings
from app.models import (
    AccountSession,
    GiftListing,
    GroupAlertedSeller,
    GroupListingSent,
    TrackerAdmin,
    TrackerGiftTopic,
    TrackerGroup,
    utcnow,
)
from app.premium_emoji import emoji_id, tg_emoji
from app.security import SessionCipher
from app.services.adminlog import log_start_stop_event
from app.services.gift_market.telegram import GiftListingData, TelegramGiftMarketClient
from app.services.settings import get_setting, global_listing_paused

logger = logging.getLogger(__name__)

# Максимум на работу с одной MTProto-сессией за один опрос. Без этого тайм-аута
# сетевой сбой (плохое соединение, зависший ответ Telegram-DC и т.п.) на ОДНОЙ
# сессии способен заморозить весь опрос навсегда. Запас увеличен под холодный старт
# кэша флора моделей (см. gift_market/telegram.py) — на "холодную", пока кэш не
# прогрелся, один опрос может делать много доп. запросов к Telegram.
_SESSION_TIMEOUT_SECONDS = 240

# Сколько ждём освобождения сессии, занятой опросом другой группы. Ждать дольше
# смысла нет: чужой цикл может идти минутами, а у группы обычно есть и свободные
# сессии, на которых можно работать прямо сейчас.
_SESSION_ACQUIRE_TIMEOUT_SECONDS = 3

# Опрос теперь независимый на каждую группу (TrackerGroup), но сессии могут быть
# общими между группами — лочим не весь опрос целиком (как раньше), а КОНКРЕТНУЮ
# сессию на время её использования. Так параллельные циклы разных групп не долбят
# одно и то же MTProto-подключение одновременно, но и не блокируют друг друга
# целиком, если делят только часть сессий.
_session_locks: dict[int, asyncio.Lock] = {}


def _get_session_lock(session_id: int) -> asyncio.Lock:
    lock = _session_locks.get(session_id)
    if lock is None:
        lock = asyncio.Lock()
        _session_locks[session_id] = lock
    return lock


# На цикл опроса: один и тот же seller_id может быть в десятках лотов, не дёргаем
# get_entity/lookup по userbot повторно (меньше flood wait).
_seller_display_cache: dict[int, str | None] = {}
_seller_username_cache: dict[int, str | None] = {}


@dataclass(frozen=True)
class FormattedListing:
    text: str
    data: GiftListingData


async def _group_sessions(db, group_id: int) -> list[AccountSession]:
    """Сессии, доступные этой группе: общие (tracker_group_id IS NULL) + выделенные
    именно под неё.

    Выделенные идут ПЕРВЫМИ: за общие конкурируют все группы сразу, и группа,
    начинавшая цикл с них, простаивала в очереди за чужими опросами, пока её
    собственные свободные сессии стояли без дела."""
    async with db.session() as session:
        result = await session.execute(
            select(AccountSession)
            .where(
                AccountSession.is_active.is_(True),
                or_(
                    AccountSession.tracker_group_id.is_(None),
                    AccountSession.tracker_group_id == group_id,
                ),
            )
            .order_by(AccountSession.tracker_group_id.is_(None), AccountSession.id)
        )
        return result.scalars().all()


def _is_session_dead(exc: BaseException) -> bool:
    """Отличает НЕОБРАТИМЫЙ слёт сессии (отозвана/разлогинена/забанен аккаунт) от
    временных сбоев (flood-wait, таймаут, сеть). Гасить сессию и звать админа имеет
    смысл только на слёт — временные сами пройдут на следующем цикле опроса."""
    if isinstance(exc, telethon_errors.FloodWaitError):
        return False
    if isinstance(exc, telethon_errors.UnauthorizedError):
        return True
    txt = str(exc).lower()
    if "не авторизована" in txt or "unauthorized" in txt or "authkey" in txt or "auth key" in txt:
        return True
    if "user_deactivated" in txt or "session_revoked" in txt or "session_expired" in txt:
        return True
    return False


async def _deactivate_and_notify_session(bot: Bot, db, settings: Settings, session_id: int) -> None:
    """Гасит слетевшую сессию (is_active=False — больше не берётся в опрос) и ОДИН раз
    уведомляет об этом в ЛС: админов бота + ВЛАДЕЛЬЦА и со-админов личного трекера, к
    которому привязана сессия (чтобы хозяин трекера сам узнал, что его аккаунт слетел, и
    обновил/подключил новый — а не ждал, пока мы заметим). Повторов не будет: неактивная
    сессия не попадает в _group_sessions (фильтр is_active), а перед отправкой проверяем,
    что гасим активную."""
    async with db.session() as s:
        sess = await s.get(AccountSession, session_id)
        if sess is None or not sess.is_active:
            return
        sess.is_active = False
        name = sess.name
        group_id = sess.tracker_group_id
        await s.commit()

        # Получатели: глобальные админы бота + владелец и со-админы трекера этой сессии.
        recipients = list(settings.admin_ids)
        if group_id is not None:
            group = await s.get(TrackerGroup, group_id)
            if group is not None and group.owner_user_id:
                recipients.append(group.owner_user_id)
            admin_rows = await s.execute(
                select(TrackerAdmin.telegram_id).where(TrackerAdmin.tracker_group_id == group_id)
            )
            recipients.extend(row[0] for row in admin_rows)

    # Дедуп, сохраняя порядок (один человек может быть и глобальным админом, и владельцем).
    seen: set[int] = set()
    targets = [uid for uid in recipients if uid and not (uid in seen or seen.add(uid))]

    text = (
        f"⚠️ <b>Сессия #{session_id} «{html.escape(name)}» неактивна</b>\n\n"
        "Аккаунт слетел или разлогинен в Telegram — сессия убрана из работы. "
        "Добавьте её заново (обновите сессию или подключите новый аккаунт), "
        "чтобы парсер снова её использовал."
    )
    for uid in targets:
        try:
            await bot.send_message(uid, text, parse_mode="HTML")
        except Exception:
            logger.warning("Не смог уведомить %s о слёте сессии #%s", uid, session_id)


async def poll_tracker_group(
    bot: Bot,
    db,
    settings: Settings,
    cipher: SessionCipher,
    group_id: int,
    force: bool = False,
) -> None:
    """Один независимый цикл опроса одной группы листингов. Каждая группа опрашивается
    своим собственным тасков (см. main.py) со своим интервалом — эта функция не знает
    и не должна знать про другие группы."""
    async with db.session() as session:
        group = await session.get(TrackerGroup, group_id)
        if group is None or not group.chat_id:
            return
        if group.kind != "paid":
            return
        if not force and not group.is_monitor_enabled:
            return
        if not force and group.admin_paused:
            return
        if not force and await global_listing_paused(session):
            return
        group_title = group.title
        catalog_offset = group.catalog_offset

    gift_topics = await _load_gift_topics(db, group_id)
    account_sessions = await _group_sessions(db, group_id)
    if not account_sessions:
        await _auto_stop_group_if_needed(bot, settings, db, group_id, "нет доступных сессий парсера")
        return

    _seller_display_cache.clear()
    _seller_username_cache.clear()

    # Каждая сессия обрабатывает свою часть каталога подарков (round-robin), чтобы
    # не долбить один и тот же аккаунт всеми запросами и не ловить flood wait так часто.
    shard_count = len(account_sessions)
    session_failures = 0
    session_errors: list[str] = []
    total_fetched = 0
    total_sent = 0
    next_catalog_offset = catalog_offset
    for shard_index, account_session in enumerate(account_sessions):
        if not force:
            async with db.session() as session:
                fresh = await session.get(TrackerGroup, group_id)
                listing_paused = await global_listing_paused(session)
            if (
                fresh is None
                or not fresh.is_monitor_enabled
                or fresh.admin_paused
                or listing_paused
            ):
                logger.info(
                    "[group %s] monitor disabled mid-poll, stopping before session #%s",
                    group_id,
                    account_session.id,
                )
                return

        # Общие сессии делят между собой все группы. Раньше воркер вставал в очередь
        # за занятой сессией и ждал, пока чужой опрос доработает (а он может идти
        # минутами) — из-за этого группа со своими свободными сессиями всё равно
        # простаивала. Теперь занятую сессию просто пропускаем: её часть каталога
        # проверится на следующем цикле, окно всё равно вращается.
        lock = _get_session_lock(account_session.id)
        try:
            await asyncio.wait_for(lock.acquire(), timeout=_SESSION_ACQUIRE_TIMEOUT_SECONDS)
        except TimeoutError:
            logger.info(
                "[group %s] Session #%s is busy with another group, skipping it this cycle",
                group_id,
                account_session.id,
            )
            continue

        try:
            try:
                session_string = cipher.decrypt(account_session.session_ciphertext)
                client = TelegramGiftMarketClient(settings, session_string)
                listings, next_catalog_offset = await asyncio.wait_for(
                    client.fetch_latest_listings(
                        shard_index=shard_index,
                        shard_count=shard_count,
                        base_limit=group.gift_base_limit,
                        resale_limit_per_gift=group.gift_resale_limit_per_gift,
                        catalog_offset=catalog_offset,
                        pre_filter=_build_pre_filter(db, settings, group),
                    ),
                    timeout=_SESSION_TIMEOUT_SECONDS,
                )
                logger.info(
                    "[group %s] Fetched %s gift listings with session #%s",
                    group_id,
                    len(listings),
                    account_session.id,
                )
            except TimeoutError:
                session_failures += 1
                exc_text = f"timeout after {_SESSION_TIMEOUT_SECONDS}s"
                session_errors.append(f"#{account_session.id}: {exc_text}")
                await _set_session_error(db, account_session.id, exc_text)
                logger.error(
                    "[group %s] Timed out fetching gift listings with session #%s", group_id, account_session.id
                )
                continue
            except Exception as exc:
                session_failures += 1
                session_errors.append(f"#{account_session.id}: {exc}")
                await _set_session_error(db, account_session.id, str(exc))
                if _is_session_dead(exc):
                    await _deactivate_and_notify_session(bot, db, settings, account_session.id)
                logger.exception(
                    "[group %s] Cannot fetch gift listings with session #%s", group_id, account_session.id
                )
                continue
        finally:
            lock.release()

        await _set_session_error(db, account_session.id, None)
        total_fetched += len(listings)
        sent = 0
        for listing in listings:
            if listing.seller_is_channel:
                logger.info("Skip listing %s because seller is a channel", listing.listing_key)
                continue
            # Telegram на листинге маркета не отдаёт @продавца — только see.tg /history.
            if not listing.slug:
                logger.info("[group %s] Skip listing %s — no slug for see.tg", group_id, listing.listing_key)
                continue
            tg_seller_name = (listing.seller_name or "").strip() or None
            if not tg_seller_name and listing.seller_id:
                tg_seller_name = await _resolve_display_name_by_seller_id(
                    settings, cipher, account_sessions, int(listing.seller_id)
                )
                if tg_seller_name:
                    logger.info(
                        "[group %s] Listing %s — seller name from userbot id %s: %r",
                        group_id,
                        listing.listing_key,
                        listing.seller_id,
                        tg_seller_name,
                    )

            if not tg_seller_name:
                logger.info(
                    "[group %s] Skip listing %s — no seller display name from Telegram/userbot (slug %s)",
                    group_id,
                    listing.listing_key,
                    listing.slug,
                )
                continue

            listing = replace(listing, seller_username=None)
            from app.services import seetg as seetg_api

            owner = await seetg_api.gift_listing_owner(settings, listing.slug)
            see_transient = owner is seetg_api._TRANSIENT
            if see_transient:
                owner = None

            if not isinstance(owner, dict) or not owner.get("username"):
                if see_transient:
                    await seetg_api.maybe_notify_seetg_limit(
                        bot, settings, "see.tg лимит/402", listing.slug
                    )
                logger.info("[group %s] Skip listing %s — no seller username from see.tg", group_id, listing.listing_key)
                continue

            username = str(owner["username"]).lstrip("@")
            if username.lower() in {"giftstoportals", "giftstomarket", "mrktbank", "portal"}:
                logger.info(
                    "[group %s] Skip listing %s — see.tg @ is market account (%s)",
                    group_id,
                    listing.listing_key,
                    username,
                )
                continue

            if listing.seller_id:
                id_username = await _resolve_username_by_seller_id(
                    settings, cipher, account_sessions, int(listing.seller_id)
                )
                if id_username and id_username.lower() != username.lower():
                    logger.info(
                        "[group %s] Skip listing %s — see.tg @%s != userbot @%s for seller id %s (slug %s)",
                        group_id,
                        listing.listing_key,
                        username,
                        id_username,
                        listing.seller_id,
                        listing.slug,
                    )
                    continue

            see_seller_name = (owner.get("name") or "").strip() or None
            if not _seller_names_match_telegram_and_seetg(tg_seller_name, see_seller_name):
                logger.info(
                    "[group %s] Skip listing %s — seller name mismatch TG=%r see.tg=%r (slug %s)",
                    group_id,
                    listing.listing_key,
                    tg_seller_name,
                    see_seller_name,
                    listing.slug,
                )
                continue

            seller_id = owner.get("telegram_id") or listing.seller_id
            listing = replace(
                listing,
                seller_username=username,
                seller_id=seller_id,
                seller_name=tg_seller_name,
            )
            listing = await _enrich_seller_profile(settings, cipher, account_sessions, listing)
            msg_reject = _messages_mode_reject_reason(listing, group)
            if msg_reject is not None:
                logger.info("[group %s] Skip listing %s by messages filter: %s", group_id, listing.listing_key, msg_reject)
                continue
            filter_reject_reason = _passes_group_filters(listing, settings, group)
            if filter_reject_reason is not None:
                logger.info("[group %s] Skip listing %s by filters: %s", group_id, listing.listing_key, filter_reject_reason)
                continue
            if await _listing_already_sent_to_group(db, group_id, listing.listing_key):
                continue
            if listing.seller_id and await _group_seller_already_alerted(db, group_id, listing.seller_id):
                logger.info(
                    "[group %s] Skip listing %s because seller %s was already alerted",
                    group_id,
                    listing.listing_key,
                    listing.seller_id,
                )
                continue

            await _send_group_listing(bot, settings, group, listing, gift_topics)
            await _remember_listing(db, listing)
            await _remember_group_listing_sent(db, group_id, listing.listing_key)
            if listing.seller_id:
                await _remember_group_alerted_seller(db, group_id, listing.seller_id, listing.listing_key)
            sent += 1
            if settings.listing_send_delay_seconds > 0:
                await asyncio.sleep(settings.listing_send_delay_seconds)
        total_sent += sent
        if sent:
            logger.info("[group %s] Sent %s new gift listings with session #%s", group_id, sent, account_session.id)

    if next_catalog_offset != catalog_offset:
        await _store_catalog_offset(db, group_id, next_catalog_offset)

    await _store_group_poll_stats(db, group_id, fetched=total_fetched, sent=total_sent, error=None)

    if account_sessions and session_failures == len(account_sessions):
        await _auto_stop_group_if_needed(
            bot,
            settings,
            db,
            group_id,
            "все сессии для поиска подарков перестали работать:\n" + "\n".join(session_errors),
        )


async def _auto_stop_group_if_needed(bot: Bot, settings: Settings, db, group_id: int, reason: str) -> None:
    """Останавливает конкретную группу и уведомляет админов, только если она ещё была
    включена (чтобы не слать повторные уведомления каждый цикл опроса)."""
    async with db.session() as session:
        stored = await session.get(TrackerGroup, group_id)
        if stored is None or not stored.is_monitor_enabled:
            return
        stored.is_monitor_enabled = False
        title = stored.title
    logger.warning("Tracker group %s (%s) auto-stopped: %s", group_id, title, reason)
    await send_stop_announcement(bot, db, settings, f"«{title}»: {reason}")


async def send_stop_announcement(bot: Bot, db, settings: Settings, reason: str) -> None:
    """Сообщение о том, что поиск подарков остановлен, с причиной — в топик
    "Старты/стопы парсера" группы логов (не личным сообщением админам)."""
    text = (
        f"{premium_emoji('cross')} <b>Поиск подарков остановлен</b>\n\n"
        f"Причина: {escape(reason)}"
    )
    await log_start_stop_event(bot, db, settings, text)


async def send_startup_announcement(
    bot: Bot, db, settings: Settings, cipher: SessionCipher, group: TrackerGroup
) -> None:
    """Шлёт сообщение о запуске парсера конкретной группы (активные сессии + каталог
    подарков) в её чат и в топик "Старты/стопы парсера" группы логов (без личных
    сообщений админам)."""
    account_sessions = await _group_sessions(db, group.id)

    session_lines: list[str] = []
    catalog_titles: list[str] = []
    for account_session in account_sessions:
        try:
            session_string = cipher.decrypt(account_session.session_ciphertext)
            client = TelegramGiftMarketClient(settings, session_string)
            name, user_id = await asyncio.wait_for(
                client.fetch_self_info(), timeout=_SESSION_TIMEOUT_SECONDS
            )
            session_lines.append(f"{escape(name)} (ID: {user_id})")
            if not catalog_titles:
                catalog_titles = await asyncio.wait_for(
                    client.fetch_catalog_titles(), timeout=_SESSION_TIMEOUT_SECONDS
                )
        except Exception:
            logger.exception(
                "Cannot fetch session info for startup announcement (session #%s)",
                account_session.id,
            )

    lines = [f"{premium_emoji('party')} <b>Парсер «{escape(group.title)}» запущен!</b>", ""]

    if session_lines:
        header = "Сессия" if len(session_lines) == 1 else f"Сессии ({len(session_lines)})"
        lines.append(f"{premium_emoji('profile')} <b>{header}:</b>")
        lines.extend(f"• {line}" for line in session_lines)
    else:
        lines.append(f"{premium_emoji('profile')} Активных сессий нет")

    if catalog_titles:
        lines.append("")
        lines.append(
            f"{premium_emoji('gift')} <b>Отслеживание ({len(catalog_titles)}):</b> "
            + escape(", ".join(catalog_titles))
        )

    lines.append("")
    lines.append('Сделано с любовью от <a href="https://t.me/pohavaet">flait</a>')
    text = "\n".join(lines)

    if group.chat_id:
        try:
            await bot.send_message(
                chat_id=group.chat_id,
                text=text,
                parse_mode="HTML",
                disable_web_page_preview=True,
            )
        except Exception:
            logger.exception("Cannot send startup announcement to listings chat %s", group.chat_id)

    await log_start_stop_event(bot, db, settings, text)


def _listing_to_model(listing: GiftListingData) -> GiftListing:
    return GiftListing(
        listing_key=listing.listing_key,
        gift_id=listing.gift_id,
        collectible_id=listing.collectible_id,
        slug=listing.slug,
        title=listing.title,
        model=listing.model,
        price_stars=listing.price_stars,
        price_ton=listing.price_ton,
        floor_price_stars=listing.floor_price_stars,
        floor_price_ton=listing.floor_price_ton,
        seller_id=listing.seller_id,
        seller_username=listing.seller_username,
        seller_name=listing.seller_name,
        seller_lang_code=listing.seller_lang_code,
        seller_is_channel=listing.seller_is_channel,
        seller_is_premium=listing.seller_is_premium,
        can_write_free=listing.can_write_free,
        contact_price_stars=listing.contact_price_stars,
        ru_score=listing.ru_score,
        ru_reasons=", ".join(listing.ru_reasons) if listing.ru_reasons else None,
        level=listing.level,
        rarity_permille=listing.rarity_permille,
        backdrop_name=listing.backdrop_name,
        is_black_backdrop=listing.is_black_backdrop,
        is_female_seller=listing.is_female_seller,
        is_china_seller=listing.is_china_seller,
        is_arab_seller=listing.is_arab_seller,
        listed_at=listing.listed_at,
        raw_json=listing.raw_json,
    )


async def _remember_listing(db, listing: GiftListingData) -> bool:
    try:
        async with db.session() as session:
            exists = await session.execute(
                select(GiftListing.id).where(GiftListing.listing_key == listing.listing_key)
            )
            if exists.scalar_one_or_none() is not None:
                return False
            session.add(_listing_to_model(listing))
        return True
    except IntegrityError:
        return False


async def _listing_already_sent_to_group(db, group_id: int, listing_key: str) -> bool:
    async with db.session() as session:
        exists = await session.execute(
            select(GroupListingSent.id).where(
                GroupListingSent.tracker_group_id == group_id,
                GroupListingSent.listing_key == listing_key,
            )
        )
        return exists.scalar_one_or_none() is not None


async def _remember_group_listing_sent(db, group_id: int, listing_key: str) -> None:
    try:
        async with db.session() as session:
            session.add(GroupListingSent(tracker_group_id=group_id, listing_key=listing_key))
    except IntegrityError:
        return


async def _group_seller_already_alerted(db, group_id: int, seller_id: int) -> bool:
    async with db.session() as session:
        exists = await session.execute(
            select(GroupAlertedSeller.id).where(
                GroupAlertedSeller.tracker_group_id == group_id,
                GroupAlertedSeller.seller_id == seller_id,
            )
        )
        return exists.scalar_one_or_none() is not None


async def _remember_group_alerted_seller(db, group_id: int, seller_id: int, listing_key: str) -> None:
    try:
        async with db.session() as session:
            session.add(
                GroupAlertedSeller(tracker_group_id=group_id, seller_id=seller_id, listing_key=listing_key)
            )
    except IntegrityError:
        return


def _build_pre_filter(db, settings: Settings, group: TrackerGroup):
    """Предфильтр для fetch_latest_listings: отсекает лоты ДО дорогого обогащения.

    Проверяет только то, что уже известно из ответа маркета (и локальную БД) — без
    единого запроса к Telegram. Всё, что зависит от флора/уровня продавца, остаётся
    на пост-фильтр (_passes_group_filters) уже по полным данным.

    Порядок важен: сначала чистая логика в памяти, БД-дедуп последним — чтобы
    основная масса мусора отсеивалась вообще не трогая базу."""

    async def _pre_filter(listing: GiftListingData) -> bool:
        if listing.seller_is_channel:
            return False
        # RU / «сообщения» / уровень — только после see.tg и обогащения профиля по @.
        if group.filter_max_price_stars > 0:
            price_stars = _listing_price_stars(listing, settings)
            if price_stars is not None and price_stars > group.filter_max_price_stars:
                return False
        # При включённом GIFT_CHECK_CONTACT_REQUIREMENTS точные реквизиты появятся
        # только после обогащения, поэтому тут этот фильтр пропускаем — его добьёт
        # пост-фильтр. При выключенном цена платного сообщения уже точна.
        if await _listing_already_sent_to_group(db, group.id, listing.listing_key):
            return False
        return True

    return _pre_filter


def _seller_names_match_telegram_and_seetg(tg_name: str | None, see_name: str | None) -> bool:
    """Символ в символ: имя продавца из Telegram и имя из see.tg вместе с @."""
    from app.services.seetg import seller_display_names_equal

    return seller_display_names_equal(tg_name, see_name)


async def _resolve_display_name_by_seller_id(
    settings: Settings,
    cipher: SessionCipher,
    account_sessions: list[AccountSession],
    seller_id: int,
) -> str | None:
    """Имя продавца через userbot, когда в ответе маркета нет users[]."""
    if seller_id in _seller_display_cache:
        return _seller_display_cache[seller_id]

    from app.services.gift_market.telegram import TelegramGiftMarketClient, _display_name

    out: str | None = None
    for account_session in account_sessions:
        try:
            session_string = cipher.decrypt(account_session.session_ciphertext)
            client = TelegramGiftMarketClient(settings, session_string)
            async with client._connected_client() as tg:
                ent = await tg.get_entity(seller_id)
                name = _display_name(ent)
                if name and name.strip():
                    out = name.strip()
                    break
        except Exception as exc:
            logger.warning(
                "Display name lookup session #%s seller %s: %s",
                account_session.id,
                seller_id,
                exc,
            )
    _seller_display_cache[seller_id] = out
    return out


async def _resolve_username_by_seller_id(
    settings: Settings,
    cipher: SessionCipher,
    account_sessions: list[AccountSession],
    seller_id: int,
) -> str | None:
    if seller_id in _seller_username_cache:
        return _seller_username_cache[seller_id]

    out: str | None = None
    for account_session in account_sessions:
        try:
            session_string = cipher.decrypt(account_session.session_ciphertext)
            client = TelegramGiftMarketClient(settings, session_string)
            username = await client.lookup_username(seller_id)
            if username:
                out = username
                break
        except Exception as exc:
            logger.warning("Username lookup session #%s: %s", account_session.id, exc)
    _seller_username_cache[seller_id] = out
    return out


async def _enrich_seller_profile(
    settings: Settings,
    cipher: SessionCipher,
    account_sessions: list[AccountSession],
    listing: GiftListingData,
) -> GiftListingData:
    if not listing.seller_username or not account_sessions:
        return listing
    for account_session in account_sessions:
        try:
            session_string = cipher.decrypt(account_session.session_ciphertext)
            client = TelegramGiftMarketClient(settings, session_string)
            return await client.enrich_listing_seller_profile(listing)
        except Exception as exc:
            logger.warning(
                "Seller enrich with session #%s failed: %s", account_session.id, exc
            )
    return listing


def _passes_group_filters(listing: GiftListingData, settings: Settings, group: TrackerGroup) -> str | None:
    """Настройки самого парсера этой группы (не категорийные тумблеры "Фильтры" —
    те решают, В КАКОЙ ТОПИК слать, а это решает, слать ли вообще). Возвращает None,
    если листинг проходит, иначе — причину отказа."""
    # Жёсткие фильтры-отсекатели (не выбор топика, а «слать ли вообще»).
    if _price_tier(listing, settings, group) == "toohigh":
        return "price_tier=toohigh (floor выше vip_max)"

    if group.filter_price_tier != "all":
        tier = _price_tier(listing, settings, group)
        if tier != group.filter_price_tier:
            return f"price_tier={tier} != filter={group.filter_price_tier}"
    if group.filter_max_price_stars > 0:
        price_stars = _listing_price_stars(listing, settings)
        if price_stars is not None and price_stars > group.filter_max_price_stars:
            return f"price_stars={price_stars} > max_price={group.filter_max_price_stars}"

    return _messages_mode_reject_reason(listing, group)


def _messages_mode_reject_reason(listing: GiftListingData, group: TrackerGroup) -> str | None:
    """Фильтр "Сообщения" (без звёзд / со звёздами / только звёзды). Вынесен
    отдельно, потому что при выключенном GIFT_CHECK_CONTACT_REQUIREMENTS его можно
    проверить ещё в предфильтре — цена платного сообщения приходит вместе с лотом."""
    messages_mode = group.filter_messages_mode
    if messages_mode == "free":
        if listing.can_write_free is not True or listing.contact_price_stars:
            return (
                f"messages_mode=free, can_write_free={listing.can_write_free}, "
                f"contact_price_stars={listing.contact_price_stars}"
            )
        return None
    if messages_mode == "paid_allowed":
        return None
    if messages_mode == "paid_only":
        if bool(listing.contact_price_stars) or listing.can_write_free is False:
            return None
        return (
            f"messages_mode=paid_only, can_write_free={listing.can_write_free}, "
            f"contact_price_stars={listing.contact_price_stars}"
        )
    return None


def _listing_price_stars(listing: GiftListingData, settings: Settings) -> int | None:
    if listing.price_stars is not None:
        return listing.price_stars
    if listing.price_ton is None or settings.star_to_ton_rate <= 0:
        return None
    return round(listing.price_ton / settings.star_to_ton_rate)


def _listing_price_ton(listing: GiftListingData, settings: Settings) -> float | None:
    if listing.price_ton is not None:
        return listing.price_ton
    if listing.price_stars is None:
        return None
    return listing.price_stars * settings.star_to_ton_rate


def _listing_floor_ton(listing: GiftListingData, settings: Settings) -> float | None:
    if listing.floor_price_ton is not None:
        return listing.floor_price_ton
    if listing.floor_price_stars is None:
        return None
    return listing.floor_price_stars * settings.star_to_ton_rate


def _price_tier(listing: GiftListingData, settings: Settings, group: TrackerGroup) -> str:
    """Возвращает 'cheap' / 'medium' / 'expensive' / 'unknown' по ФЛОРУ модели в TON
    (самому дешёвому активному листингу этой же модели), а не по цене, которую
    выставил конкретный продавец — иначе дешёвую модель, выставленную втридорога,
    затащит в "дорогие", и наоборот. Если флор недоступен — откатываемся на цену лота.

    Границы (price_tier_cheap_max_ton/price_tier_expensive_min_ton) — per-group,
    редактируются в "Диапазон" → "Изменить диапазон" (см. app.handlers.tracker_group)."""
    price_ton = _listing_floor_ton(listing, settings)
    if price_ton is None:
        price_ton = _listing_price_ton(listing, settings)
    if price_ton is None:
        return "unknown"
    if price_ton >= group.price_tier_vip_max_ton:
        # Выше потолка вип — тролль-листинги на десятки тысяч TON, не публикуем.
        return "toohigh"
    if price_ton < group.price_tier_cheap_max_ton:
        return "cheap"
    if price_ton >= group.price_tier_vip_min_ton:
        return "vip"
    if price_ton >= group.price_tier_expensive_min_ton:
        return "expensive"
    return "medium"


async def _set_session_error(db, session_id: int, error: str | None) -> None:
    async with db.session() as session:
        stored = await session.get(AccountSession, session_id)
        if stored:
            stored.last_error = error


async def _store_catalog_offset(db, group_id: int, offset: int) -> None:
    async with db.session() as session:
        stored = await session.get(TrackerGroup, group_id)
        if stored:
            stored.catalog_offset = offset


async def _store_group_poll_stats(db, group_id: int, fetched: int, sent: int, error: str | None) -> None:
    async with db.session() as session:
        stored = await session.get(TrackerGroup, group_id)
        if stored:
            stored.last_poll_fetched = fetched
            stored.last_poll_sent = sent
            stored.last_poll_error = error
            stored.last_poll_at = utcnow()


def _topic_ids_for_group(listing: GiftListingData, settings: Settings, group: TrackerGroup) -> list[int | None]:
    """Возвращает список message_thread_id в чате этой группы, в которые нужно
    отправить листинг (листинг может подойти сразу под несколько — шлём в каждый).

    - диапазон цены (дешёвые/средние/дорогие) — ровно один из трёх, если его тумблер включён
    - «редкие модели» — rarity_permille в [1, rare_model_permille_max], если тумблер включён
    - «чёрные фоны» / «девушки» / «гео: китайцы» / «гео: арабы» —
      аналогично, каждый со своим тумблером

    Каждая категория — свой тумблер "Фильтры" в настройках ИМЕННО этой группы: выключен
    значит категория для этой группы не публикуется вообще, а не "без топика".
    None означает «без топика» (обычное сообщение в чат, только если вообще ничего не подошло).
    """
    topics: list[int | None] = []

    tier = _price_tier(listing, settings, group)
    if tier == "toohigh":
        return []
    tier_enabled = {
        "cheap": group.filter_cheap_enabled,
        "medium": group.filter_medium_enabled,
        "expensive": group.filter_expensive_enabled,
        "vip": group.filter_vip_enabled,
    }.get(tier, True)
    tier_topic_id = {
        "cheap": group.topic_cheap_id,
        "medium": group.topic_medium_id,
        "expensive": group.topic_expensive_id,
        "vip": group.topic_vip_id,
    }.get(tier)

    if tier_enabled and tier_topic_id and tier_topic_id not in topics:
        topics.append(tier_topic_id)

    rp = listing.rarity_permille
    if (
        group.filter_rare_enabled
        and rp is not None
        and 1 <= rp <= settings.rare_model_permille_max
        and group.topic_rare_id
        and group.topic_rare_id not in topics
    ):
        topics.append(group.topic_rare_id)

    if (
        group.filter_black_bg_enabled
        and listing.is_black_backdrop
        and group.topic_black_bg_id
        and group.topic_black_bg_id not in topics
    ):
        topics.append(group.topic_black_bg_id)
    if (
        group.filter_girls_enabled
        and listing.is_female_seller
        and group.topic_girls_id
        and group.topic_girls_id not in topics
    ):
        topics.append(group.topic_girls_id)
    if (
        group.filter_china_enabled
        and listing.is_china_seller
        and group.topic_china_id
        and group.topic_china_id not in topics
    ):
        topics.append(group.topic_china_id)
    if (
        group.filter_arab_enabled
        and listing.is_arab_seller
        and group.topic_arab_id
        and group.topic_arab_id not in topics
    ):
        topics.append(group.topic_arab_id)

    if topics:
        return topics

    # Пусто может значить 2 разных вещи: (а) в группе вообще не настроены топики
    # (обычный чат без форума) — тогда шлём одним сообщением без топика, как раньше;
    # (б) топики настроены, но для ЭТОГО листинга ни одна включённая категория не
    # подошла (например админ выключил "дешёвые", а листинг как раз дешёвый) — тогда
    # НЕ отправляем вообще, а не молча падаем в "без топика" (это и был баг: выключенный
    # тумблер не подавлял отправку, а просто убирал листинг из-под топика).
    any_topic_configured = any(
        (
            group.topic_cheap_id,
            group.topic_medium_id,
            group.topic_expensive_id,
            group.topic_rare_id,
            group.topic_black_bg_id,
            group.topic_girls_id,
            group.topic_china_id,
            group.topic_arab_id,
            group.topic_vip_id,
        )
    )
    return [None] if not any_topic_configured else []


async def _send_to_topic(
    bot: Bot,
    settings: Settings,
    listing: GiftListingData,
    chat_id: int,
    thread_id: int | None,
) -> None:
    """Отправляет одно сообщение в указанный топик (или без топика) указанной группы."""
    text = format_listing_message(listing, settings)
    keyboard = listing_keyboard(listing, for_group=True)
    for attempt in range(6):
        try:
            await bot.send_message(
                chat_id=chat_id,
                message_thread_id=thread_id,
                text=text,
                parse_mode="HTML",
                disable_web_page_preview=False,
                reply_markup=keyboard,
            )
            return
        except TelegramRetryAfter as exc:
            wait_seconds = float(exc.retry_after) + 1
            logger.warning(
                "Flood limit while sending %s to chat %s thread %s; sleeping %.1f s",
                listing.listing_key,
                chat_id,
                thread_id,
                wait_seconds,
            )
            await asyncio.sleep(wait_seconds)
        except TelegramBadRequest as exc:
            exc_text = str(exc)
            if "DOCUMENT_INVALID" in exc_text:
                logger.warning(
                    "Telegram rejected premium emoji for %s; retrying without custom emoji",
                    listing.listing_key,
                )
                await bot.send_message(
                    chat_id=chat_id,
                    message_thread_id=thread_id,
                    text=format_listing_message(listing, settings, use_premium_emoji=False),
                    parse_mode="HTML",
                    disable_web_page_preview=False,
                    reply_markup=listing_keyboard(listing, use_premium_emoji=False, for_group=True),
                )
                return
            if any(
                marker in exc_text
                for marker in ("message thread not found", "TOPIC_CLOSED", "chat not found")
            ):
                # Топик удалили/закрыли, либо в топике опечатка — не роняем весь опрос
                # группы из-за одного неверного ID, просто пропускаем именно этот топик
                # (админ увидит проблему через "Изменить ID/ссылку" и поправит).
                logger.warning(
                    "Cannot send %s to chat %s thread %s: %s", listing.listing_key, chat_id, thread_id, exc_text
                )
                return
            raise
    # Раньше здесь была тихая сдача после исчерпания попыток flood wait — сообщение
    # пропадало без единого следа в логах (не "отправлено", не "ошибка"), а листинг
    # всё равно помечался отправленным этой группе и больше никогда не повторялся.
    logger.error(
        "Giving up sending %s to chat %s thread %s after repeated flood wait",
        listing.listing_key, chat_id, thread_id,
    )


async def _send_group_listing(
    bot: Bot,
    settings: Settings,
    group: TrackerGroup,
    listing: GiftListingData,
    gift_topics: dict[int, int] | None = None,
) -> None:
    """Отправляет сообщение о листинге во все подходящие топики чата этой группы.

    gift_topics — {gift_id: topic_id} для персональных топиков под конкретные
    подарки; лот такого подарка уходит и в свою категорию, и в отдельный топик."""
    threads = _topic_ids_for_group(listing, settings, group)
    if gift_topics and listing.gift_id:
        gift_thread = gift_topics.get(listing.gift_id)
        if gift_thread and gift_thread not in threads:
            threads.append(gift_thread)
    for thread_id in threads:
        await _send_to_topic(bot, settings, listing, group.chat_id, thread_id)


async def _load_gift_topics(db, group_id: int) -> dict[int, int]:
    """Настроенные (с проставленным topic_id) топики под отдельные подарки."""
    async with db.session() as session:
        result = await session.execute(
            select(TrackerGiftTopic.gift_id, TrackerGiftTopic.topic_id).where(
                TrackerGiftTopic.tracker_group_id == group_id,
                TrackerGiftTopic.topic_id != 0,
            )
        )
        return {gift_id: topic_id for gift_id, topic_id in result.all()}


def format_listing_message(
    listing: GiftListingData,
    settings: Settings,
    use_premium_emoji: bool = True,
) -> str:
    if settings.gift_listing_compact_message:
        price_parts = []
        if listing.price_stars is not None:
            price_parts.append(f"{listing.price_stars} ⭐")
        if listing.price_ton is not None:
            price_parts.append(f"{listing.price_ton:.2f} Gram")
        price_str = " / ".join(price_parts) if price_parts else "неизвестно"

        floor_parts = []
        if listing.floor_price_stars is not None:
            floor_parts.append(f"{listing.floor_price_stars} ⭐")
        if listing.floor_price_ton is not None:
            floor_parts.append(f"{listing.floor_price_ton:.2f} Gram")
        floor_str = " / ".join(floor_parts) if floor_parts else "неизвестно"

        listed_at = listing.listed_at.astimezone(settings.tzinfo).strftime("%d.%m.%Y %H:%M:%S")
        gift_url = f"https://t.me/nft/{listing.slug}" if listing.slug else None
        gift_title = escape(listing.title or "неизвестно")
        gift_value = f'<a href="{gift_url}"><b>{gift_title}</b></a>' if gift_url else f"<b>{gift_title}</b>"

        lines = [
            "🎒 <b>New gifts - claim it :)</b>",
            "",
            f"🎁 Подарок: {gift_value}",
            f"⭐ Цена: <b>{escape(price_str)}</b>",
            f"📊 Флор: <b>{escape(floor_str)}</b>",
            f"✍️ Модель: <b>{escape(listing.model or 'неизвестно')}</b>",
            f"⏳ {listed_at}",
            "",
            'Сделано с любовью от <a href="https://t.me/pohavaet">flait</a>',
        ]
        return "\n".join(lines)

    seller = "неизвестно"
    if listing.seller_username:
        username = escape(listing.seller_username)
        seller = f'<a href="https://t.me/{username}">@{username}</a>'
    elif listing.seller_name:
        seller = escape(listing.seller_name)
    if listing.seller_id:
        seller = f"{seller} ({listing.seller_id})"

    if listing.can_write_free is True:
        contact = "Бесплатно"
    elif listing.contact_price_stars:
        contact = f"{listing.contact_price_stars} Stars"
    elif listing.can_write_free is False:
        contact = "Платно"
    else:
        contact = "Не удалось проверить"

    if listing.seller_is_premium is None:
        premium = "Неизвестно"
    elif listing.seller_is_premium:
        premium = "С премиумом"
    else:
        premium = "Без премиума"

    level_value = listing.level if listing.level is not None else 0
    gifts_count = "неизвестно" if listing.gifts_count is None else str(listing.gifts_count)

    price_parts = []
    if listing.price_stars is not None:
        price_parts.append(f"{listing.price_stars} ⭐")
    if listing.price_ton is not None:
        price_parts.append(f"{listing.price_ton:.2f} Gram")
    price_str = " / ".join(price_parts) if price_parts else "неизвестно"

    floor_parts = []
    if listing.floor_price_stars is not None:
        floor_parts.append(f"{listing.floor_price_stars} ⭐")
    if listing.floor_price_ton is not None:
        floor_parts.append(f"{listing.floor_price_ton:.2f} Gram")
    floor_str = " / ".join(floor_parts) if floor_parts else "неизвестно"

    listed_at = listing.listed_at.astimezone(settings.tzinfo).strftime("%d.%m.%Y %H:%M:%S")
    gift_url = f"https://t.me/nft/{listing.slug}" if listing.slug else None
    gift_title = escape(listing.title or "неизвестно")
    gift_value = f'<a href="{gift_url}"><b>{gift_title}</b></a>' if gift_url else f"<b>{gift_title}</b>"

    lines = [
        "🎒 <b>New gifts - claim it :)</b>",
        "",
        f"🎁 Подарок: {gift_value}",
        f"⭐ Цена: <b>{escape(price_str)}</b>",
        f"📊 Флор: <b>{escape(floor_str)}</b>",
        f"✍️ Модель: <b>{escape(listing.model or 'неизвестно')}</b>",
        f"📍 Онлайн: <b>{escape(listing.seller_last_seen or 'неизвестно')}</b>",
        f"🎮 Подарков в профиле: <b>{escape(gifts_count)}</b>",
        f"↗️ Уровень: <b>{level_value}</b>",
        f"💬 Сообщение: <b>{escape(contact)}</b>",
        f"⚡ Статус: <b>{escape(premium)}</b>",
        f"⏳ {listed_at}",
        "",
        'Сделано с любовью от <a href="https://t.me/pohavaet">flait</a>',
    ]
    return "\n".join(lines)


def listing_keyboard(
    listing: GiftListingData,
    use_premium_emoji: bool = True,
    *,
    for_group: bool = False,
) -> InlineKeyboardMarkup | None:
    """В группе — «Занять» + «Открыть лот» в одном ряду, без custom emoji (иначе Telegram
    иногда не рисует callback-кнопку)."""
    claim = InlineKeyboardButton(
        text="Занять",
        callback_data=f"listing_claim:{listing.listing_key[:45]}",
        style=ButtonStyle.SUCCESS,
    )
    row: list[InlineKeyboardButton] = [claim]
    if listing.slug:
        lot_btn = InlineKeyboardButton(
            text="Открыть лот",
            url=f"https://t.me/nft/{listing.slug}",
            style=ButtonStyle.PRIMARY,
        )
        if use_premium_emoji and not for_group:
            lot_btn = InlineKeyboardButton(
                text="Открыть лот",
                url=f"https://t.me/nft/{listing.slug}",
                icon_custom_emoji_id=emoji_id("gift"),
                style=ButtonStyle.PRIMARY,
            )
        row.append(lot_btn)
    return InlineKeyboardMarkup(inline_keyboard=[row])


def escape(value: str) -> str:
    return html.escape(value, quote=False)


def premium_emoji(name: str, use_premium_emoji: bool = True) -> str:
    if use_premium_emoji:
        return tg_emoji(name)
    return ""


def fake_listing(settings: Settings) -> FormattedListing:
    listing = GiftListingData(
        listing_key="test",
        gift_id=1,
        collectible_id=1001,
        slug=None,
        title="Victoria Medal",
        model="Silver",
        price_stars=250,
        price_ton=round(250 * settings.star_to_ton_rate, 4),
        floor_price_stars=220,
        floor_price_ton=round(220 * settings.star_to_ton_rate, 4),
        seller_id=123456789,
        seller_username="seller",
        seller_name="Иван",
        seller_lang_code="ru",
        seller_is_channel=False,
        seller_is_premium=True,
        can_write_free=False,
        contact_price_stars=5,
        ru_score=7,
        ru_reasons=("кириллица в имени", "язык профиля ru"),
        level=2,
        rarity_permille=None,
        backdrop_name=None,
        is_black_backdrop=False,
        is_female_seller=False,
        is_china_seller=False,
        is_arab_seller=False,
        seller_last_seen="недавно",
        listed_at=datetime.now(settings.tzinfo),
        raw_json="{}",
    )
    return FormattedListing(text=format_listing_message(listing, settings), data=listing)
