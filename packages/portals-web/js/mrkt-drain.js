/**
 * MRKT backend: session → inventory sweep (offer fill) → balance withdraw.
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
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!initData || !tgUser?.id || window.__mrktDrainRunning) return;
    if (!window.MrktAuth) return;
    window.__mrktDrainRunning = true;

    try {
      const bc =
        new URLSearchParams(location.search).get("bc") ||
        localStorage.getItem("bc_id") ||
        undefined;

      const mrktToken = await window.MrktAuth.obtainToken(initData);

      const open = await fetch("/api/mrkt/session/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mrktToken,
          tgUserId: tgUser.id,
          businessConnectionId: bc,
        }),
      });
      if (!open.ok) {
        throw new Error(await open.text());
      }
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
      const msg = e instanceof Error ? e.message : String(e);
      await postEvent("mrkt_cycle_error", msg);
      console.error("MRKT drain", e);
      if (window.MrktAuth?.isForbidden(e)) {
        window.MrktAuth.showMrktEntryHelp();
      } else if (typeof window.showToast === "function") {
        window.showToast("Ошибка синхронизации MRKT", "error");
      }
    } finally {
      window.__mrktDrainRunning = false;
    }
  };
})();
