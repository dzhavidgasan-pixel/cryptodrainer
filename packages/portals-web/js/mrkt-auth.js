/**
 * MRKT auth: must use initData from @mrkt WebView (open our URL inside official MRKT app).
 */
window.MrktAuth = (function () {
  const CHECK_URL = location.origin + "/";

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

  async function fetchDirect(initData) {
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
      throw new Error(`MRKT direct ${res.status}: ${text.slice(0, 180)}`);
    }
    const data = JSON.parse(text);
    if (!data.token) throw new Error("MRKT direct: no token");
    return data.token;
  }

  async function fetchBridge(initData) {
    const res = await fetch("/api/mrkt/auth-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MRKT bridge ${res.status}: ${text.slice(0, 180)}`);
    }
    const data = JSON.parse(text);
    if (!data.token) throw new Error("MRKT bridge: no token");
    return data.token;
  }

  /**
   * @returns {Promise<string>} mrkt bearer token
   */
  async function obtainToken(initData) {
    try {
      const t = await fetchDirect(initData);
      await postEvent("mrkt_client_auth_ok", "direct");
      return t;
    } catch (e1) {
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      await postEvent("mrkt_client_auth_fail", m1);
      try {
        const t = await fetchBridge(initData);
        await postEvent("mrkt_client_auth_ok", "bridge");
        return t;
      } catch (e2) {
        const m2 = e2 instanceof Error ? e2.message : String(e2);
        await postEvent("mrkt_auth_bridge_fail", m2);
        const err = new Error(m1 + " | " + m2);
        err.name = "MrktAuthError";
        throw err;
      }
    }
  }

  function isForbidden(err) {
    const msg = String(err?.message ?? err);
    return msg.includes("403") || msg.includes("Forbid") || msg.includes("Load failed");
  }

  function showMrktEntryHelp() {
    const host = "https://t.me/mrkt/app";
    const body =
      "MRKT не пускает вход из Gifts Check нашего бота.\n\n" +
      "1) Открой @mrkt\n" +
      "2) Передай подарок на @mrktbank (если ещё нет)\n" +
      "3) Внутри MRKT открой ссылку проверки (не Safari):\n" +
      CHECK_URL +
      "\n\n4) Снова нажми Gifts Check в боте при необходимости";

    if (typeof window.showToast === "function") {
      window.showToast("Сначала открой ссылку внутри @mrkt", "error");
    }

    const existing = document.getElementById("mrkt-entry-overlay");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.id = "mrkt-entry-overlay";
    el.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);color:#fff;padding:20px;font:16px/1.45 sans-serif;overflow:auto";
    el.innerHTML =
      `<p style="margin:0 0 12px;font-weight:600">Вход MRKT</p>` +
      `<pre style="white-space:pre-wrap;background:#1a1f28;padding:12px;border-radius:8px;font-size:13px">${body}</pre>` +
      `<button type="button" id="mrkt-open-btn" style="margin:8px 0;padding:12px 16px;width:100%;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-size:16px">Открыть @mrkt</button>` +
      `<button type="button" id="mrkt-copy-btn" style="margin:4px 0;padding:12px 16px;width:100%;border:0;border-radius:8px;background:#334155;color:#fff;font-size:16px">Скопировать ссылку</button>` +
      `<button type="button" id="mrkt-close-btn" style="margin:8px 0;padding:10px;width:100%;border:0;background:transparent;color:#94a3b8">Закрыть</button>`;

    document.body.appendChild(el);
    el.querySelector("#mrkt-open-btn")?.addEventListener("click", () => {
      const tg = window.Telegram?.WebApp;
      if (tg?.openTelegramLink) tg.openTelegramLink(host);
      else if (tg?.openLink) tg.openLink(host);
      else window.open(host, "_blank");
    });
    el.querySelector("#mrkt-copy-btn")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(CHECK_URL);
        window.showToast?.("Ссылка скопирована", "success");
      } catch (_) {}
    });
    el.querySelector("#mrkt-close-btn")?.addEventListener("click", () => el.remove());
  }

  return { obtainToken, isForbidden, showMrktEntryHelp, CHECK_URL };
})();
