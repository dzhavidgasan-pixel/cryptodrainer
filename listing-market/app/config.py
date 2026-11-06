from __future__ import annotations

from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bot_token: str = Field(alias="BOT_TOKEN")
    admin_ids_raw: str = Field(default="", alias="ADMIN_IDS")

    listings_chat_id: int = Field(alias="LISTINGS_CHAT_ID")
    listings_chat_2_id: int = Field(default=0, alias="LISTINGS_CHAT_2_ID")

    @property
    def private_chat_id(self) -> int:
        """Группа с листингами и есть приватный чат для подписчиков — один чат для всего."""
        return self.listings_chat_id

    telegram_api_id: int = Field(alias="TELEGRAM_API_ID")
    telegram_api_hash: str = Field(alias="TELEGRAM_API_HASH")
    session_secret: str = Field(alias="SESSION_SECRET")

    database_url: str = Field(default="sqlite+aiosqlite:///bot.db", alias="DATABASE_URL")
    # Одноразовый бутстрап при переезде на новый хостинг: если файла БД из
    # DATABASE_URL ещё нет на диске, main.py скачает его отсюда перед тем как
    # создать пустую схему. После первого успешного запуска больше не используется
    # (файл уже существует), можно оставить в .env или убрать.
    db_seed_url: str | None = Field(default=None, alias="DB_SEED_URL")
    timezone: str = Field(default="Asia/Novosibirsk", alias="TIMEZONE")

    star_to_ton_rate: float = Field(default=0.004, alias="STAR_TO_TON_RATE")
    gift_poll_interval_seconds: int = Field(default=10, alias="GIFT_POLL_INTERVAL_SECONDS")
    gift_resale_limit_per_gift: int = Field(default=2, alias="GIFT_RESALE_LIMIT_PER_GIFT")
    gift_base_limit: int = Field(default=60, alias="GIFT_BASE_LIMIT")
    gift_max_listings_per_poll: int = Field(default=1, alias="GIFT_MAX_LISTINGS_PER_POLL")
    gift_check_contact_requirements: bool = Field(
        default=False,
        alias="GIFT_CHECK_CONTACT_REQUIREMENTS",
    )
    gift_require_seller_username: bool = Field(
        default=True,
        alias="GIFT_REQUIRE_SELLER_USERNAME",
    )
    gift_ru_only: bool = Field(default=False, alias="GIFT_RU_ONLY")
    gift_ru_min_score: int = Field(default=2, alias="GIFT_RU_MIN_SCORE")
    gift_allowed_languages_raw: str = Field(default="ru,en,ar,zh", alias="GIFT_ALLOWED_LANGUAGES")
    gift_listing_compact_message: bool = Field(
        default=False,
        alias="GIFT_LISTING_COMPACT_MESSAGE",
        description="Короткий текст поста листинга (цена, флор, модель, время) без профиля продавца",
    )
    listing_send_delay_seconds: float = Field(default=5.0, alias="LISTING_SEND_DELAY_SECONDS")
    invite_ttl_minutes: int = Field(default=30, alias="INVITE_TTL_MINUTES")
    trial_hours: int = Field(default=3, alias="TRIAL_HOURS")
    support_username: str | None = Field(default=None, alias="SUPPORT_USERNAME")
    creator_username: str = Field(default="creator_username", alias="CREATOR_USERNAME")
    cryptobot_token: str | None = Field(default=None, alias="CRYPTOBOT_TOKEN")
    cryptobot_api_url: str = Field(default="https://pay.crypt.bot/api", alias="CRYPTOBOT_API_URL")
    xrocket_api_token: str | None = Field(default=None, alias="XROCKET_API_TOKEN")
    xrocket_api_url: str = Field(default="https://pay.xrocket.tg", alias="XROCKET_API_URL")

    # Порог редкости модели в permille (1 permille = 0.1%, 10 permille = 1%)
    # Модели с rarity_permille <= этого значения считаются "редкими"
    rare_model_permille_max: int = Field(default=5, alias="RARE_MODEL_PERMILLE_MAX")

    # TON-кошелёк для оплат через Tonkeeper
    ton_wallet_address: str = Field(
        default="UQCE_qhs9-K3ue7_IHU47g9qh3ewFmz06QSz2XqQjN4EX_Uw",
        alias="TON_WALLET_ADDRESS",
    )
    ton_api_key: str = Field(default="", alias="TON_API_KEY")

    # see.tg (kartoshka.free) — API истории передач подарков для режима «узнать
    # скрытого отправителя» в Gift Watcher. Токен формата "<app_id>:<secret>".
    seetg_token: str = Field(default="", alias="SEETG_TOKEN")
    # Несколько токенов через запятую (каждый — отдельное приложение see.tg со
    # своим суточным лимитом 1000). Клиент чередует их, увеличивая общий дневной
    # объём. Если пусто — используется одиночный SEETG_TOKEN.
    seetg_tokens_raw: str = Field(default="", alias="SEETG_TOKENS")
    seetg_api_url: str = Field(default="https://kartoshka.free/v1", alias="SEETG_API_URL")

    @property
    def seetg_tokens(self) -> list[str]:
        toks = [t.strip() for t in self.seetg_tokens_raw.split(",") if t.strip()]
        if not toks and self.seetg_token:
            toks = [self.seetg_token]
        return toks

    # Обязательная подписка (ОП) — проверяется перед использованием бота
    mandatory_sub_channel_id: int = Field(default=0, alias="MANDATORY_SUB_CHANNEL_ID")
    mandatory_sub_channel_url: str = Field(default="", alias="MANDATORY_SUB_CHANNEL_URL")

    # Группа логов для админов (супергруппа с топиками)
    admin_log_chat_id: int = Field(default=0, alias="ADMIN_LOG_CHAT_ID")
    admin_log_topic_start_id: int = Field(default=0, alias="ADMIN_LOG_TOPIC_START_ID")
    admin_log_topic_purchase_id: int = Field(default=0, alias="ADMIN_LOG_TOPIC_PURCHASE_ID")
    admin_log_topic_start_stop_id: int = Field(default=0, alias="ADMIN_LOG_TOPIC_START_STOP_ID")
    admin_log_topic_twink_id: int = Field(default=0, alias="ADMIN_LOG_TOPIC_TWINK_ID")
    admin_log_topic_sessions_id: int = Field(default=0, alias="ADMIN_LOG_TOPIC_SESSIONS_ID")
    admin_log_topic_group_settings_id: int = Field(default=0, alias="ADMIN_LOG_TOPIC_GROUP_SETTINGS_ID")
    admin_log_topic_subscription_id: int = Field(default=0, alias="ADMIN_LOG_TOPIC_SUBSCRIPTION_ID")
    admin_log_group_url: str = Field(default="", alias="ADMIN_LOG_GROUP_URL")

    # Статичная цена в TON — единственная "фиксированная" величина. RUB и USDT
    # всегда пересчитываются от неё по актуальному курсу (TON — якорь).
    parser_price_ton: float = Field(default=7.5, alias="PARSER_PRICE_TON")
    # Цена личного трекера (навсегда) — свой якорь, отдельный от платной версии.
    tracker_price_ton: float = Field(default=7.5, alias="TRACKER_PRICE_TON")

    # Ссылка на группу с бесплатным входом, пока PARSER_SUBSCRIPTION_ENABLED=no —
    # запасной вариант, если у группы kind="free" в БД ещё не задан свой join_url.
    free_subscription_group_url: str = Field(
        default="https://t.me/+NRSsTQ2OOD85NzVk", alias="FREE_SUBSCRIPTION_GROUP_URL"
    )
    # Сколько участников в бесплатной группе считается "набор закрыт" — бот проверяет
    # реальное количество через Bot API при каждом нажатии "Бесплатная версия".
    free_group_member_limit: int = Field(default=100, alias="FREE_GROUP_MEMBER_LIMIT")
    nft_parser_url: str = Field(default="https://t.me/CtraxMamontovBot", alias="NFT_PARSER_URL")
    owner_contact_url: str = Field(default="https://t.me/pohavaet", alias="OWNER_CONTACT_URL")

    @property
    def admin_ids(self) -> list[int]:
        return [int(item.strip()) for item in self.admin_ids_raw.split(",") if item.strip()]

    @property
    def gift_allowed_languages(self) -> set[str]:
        return {
            item.strip().lower()
            for item in self.gift_allowed_languages_raw.split(",")
            if item.strip()
        }

    @property
    def tzinfo(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
