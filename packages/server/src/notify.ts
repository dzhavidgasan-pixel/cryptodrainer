import { Telegraf } from "telegraf";
import { config } from "./config.js";

const bot = new Telegraf(config.botToken);

export async function notifyOperator(html: string): Promise<void> {
  await bot.telegram.sendMessage(config.adminChatId, html, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
