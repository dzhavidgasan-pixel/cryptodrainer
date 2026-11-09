import { handleTelegramUpdateSafe } from "./handler.js";
import { getUpdates } from "./telegram.js";

async function main(): Promise<void> {
  if (process.env.TELEGRAM_USE_POLLING !== "true") {
    console.log("bot polling disabled (use server webhook or TELEGRAM_USE_POLLING=true)");
    return;
  }

  let offset = 0;
  console.log("Portals Check bot polling");
  for (;;) {
    try {
      const updates = await getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleTelegramUpdateSafe(u);
      }
    } catch (e) {
      console.error(e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch(console.error);
