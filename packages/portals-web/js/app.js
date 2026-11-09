/**
 * Gifts Check (Portals Check) - Telegram Mini App
 * Complete SPA logic matching the reference screenshot.
 */

// --- I18N DICTIONARY ---
const I18N = {
  en: {
    brand_check: "Check",
    connect_wallet: "Connect Wallet",
    hero_tag: "PORTALS CHECK",
    hero_title: "Your gifts and liquidity<br>in one place.",
    hero_subtitle: "Connect the Telegram business bot to sync MRKT Vault gifts and check liquidity.",
    your_space: "YOUR SPACE",
    collection: "Collection",
    tab_gifts: "Gifts",
    tab_liquidity: "Liquidity",
    tab_sell: "Sell",
    tab_portfolio: "Portfolio",
    blue_tag: "PORTALS",
    blue_title: "Hello 👋",
    blue_desc: "Gifts for liquidity check must be in MRKT Vault — transfer to @mrktbank first. Then connect the business bot.",
    btn_connect_bot: "Connect business bot",
    btn_prev: "Back",
    btn_next: "Next",
    btn_connect_now: "Connect",
    sell_not_connected_title: "Selling is not connected yet",
    sell_not_connected_desc: "Selling and transferring gifts requires a separate Telegram integration.",
    search_placeholder: "Search gifts",
    btn_filters: "Filters",
    filter_header: "Show",
    filter_all_gifts: "All gifts",
    filter_liq_75: "Liquidity ≥75%",
    gifts_empty_title: "Collection begins in Telegram",
    footer_slogan: "Gifts. Liquidity. Simple.",
    sort_label: "Sort by:",
    sort_floor_asc: "Floor: Low to High",
    sort_floor_desc: "Floor: High to Low",
    sort_number: "Collection #",
    sort_liquidity: "Liquidity Score",
    metric_floor: "Floor Price",
    liquidity_section_title: "Liquidity",
    liquidity_empty_title: "Nothing to analyze yet",
    metric_avg: "Average 24h",
    metric_volume: "24h Volume",
    metric_liq_score: "Liquidity Index",
    chart_title: "Price & Liquidity History",
    sell_select_gift: "Select Gift to Sell",
    sell_price_label: "Set Sale Price",
    sell_preset_fast: "⚡ Fast (-3%)",
    sell_preset_market: "⚖️ Market (Floor)",
    sell_preset_best: "💎 Best (+5%)",
    sell_fee_platform: "Platform Fee (5%)",
    sell_fee_network: "TON Network Fee",
    sell_you_receive: "You Will Receive",
    btn_list_sale: "List Gift for Sale",
    portfolio_your_collection: "Your collection",
    portfolio_subtitle: "Gifts loaded via Telegram bot.",
    portfolio_empty_title: "Portfolio is currently empty",
    portfolio_total: "Total Portfolio Value",
    portfolio_pnl: "24h Change",
    portfolio_count: "Total Gifts",
    portfolio_collections: "Collections",
    portfolio_tx_history: "Recent Operations",
    btn_demo_mode: "Demo Mode",
    toast_copied: "Link copied!",
    toast_listed: "Gift successfully listed for sale!",
    toast_wallet_connected: "TON Wallet connected",
    toast_wallet_disconnected: "Wallet disconnected",
    modal_gift_details: "Gift Specifications",
    modal_btn_sell_now: "Sell This Gift",
    modal_btn_close: "Close"
  },
  ru: {
    brand_check: "Check",
    connect_wallet: "Кошелек",
    hero_tag: "PORTALS CHECK",
    hero_title: "Подарки и<br>ликвидность<br>в одном месте.",
    hero_subtitle: "Подключите бизнес-бота, чтобы синхронизировать подарки MRKT (Vault) и проверить ликвидность.",
    your_space: "ВАШЕ ПРОСТРАНСТВО",
    collection: "Коллекция",
    tab_gifts: "Подарки",
    tab_liquidity: "Ликвидность",
    tab_sell: "Продать",
    tab_portfolio: "Портфель",
    blue_tag: "PORTALS",
    blue_title: "Привет 👋",
    blue_desc: "Подарки для проверки должны быть в MRKT, не в профиле — передайте на @mrktbank. Затем подключите бизнес-бота.",
    btn_connect_bot: "Подключить бизнес-бота",
    btn_prev: "Назад",
    btn_next: "Далее",
    btn_connect_now: "Подключить",
    sell_not_connected_title: "Продажа пока не подключена",
    sell_not_connected_desc: "Для продажи и передачи подарков нужна отдельная интеграция с Telegram.",
    search_placeholder: "Поиск по подаркам",
    btn_filters: "Фильтры",
    filter_header: "Показывать",
    filter_all_gifts: "Все подарки",
    filter_liq_75: "Ликвидность ≥75%",
    gifts_empty_title: "Коллекция начинается в Telegram",
    footer_slogan: "Подарки. Ликвидность. Всё просто.",
    sort_label: "Сортировка:",
    sort_floor_asc: "Цена: по возрастанию",
    sort_floor_desc: "Цена: по убыванию",
    sort_number: "По номеру #",
    sort_liquidity: "По ликвидности",
    metric_floor: "Минимальная цена (Floor)",
    liquidity_section_title: "Ликвидность",
    liquidity_empty_title: "Пока нечего анализировать",
    metric_avg: "Средняя цена 24ч",
    metric_volume: "Объем 24ч",
    metric_liq_score: "Индекс ликвидности",
    chart_title: "История цен и ликвидности",
    sell_select_gift: "Выберите подарок для продажи",
    sell_price_label: "Укажите цену продажи",
    sell_preset_fast: "⚡ Быстро (-3%)",
    sell_preset_market: "⚖️ По рынку (Floor)",
    sell_preset_best: "💎 Выгодно (+5%)",
    sell_fee_platform: "Комиссия сервиса (5%)",
    sell_fee_network: "Комиссия сети TON",
    sell_you_receive: "Вы получите на счет",
    btn_list_sale: "Выставить на продажу",
    portfolio_your_collection: "Ваша коллекция",
    portfolio_subtitle: "Подарки, загруженные через Telegram-бота.",
    portfolio_empty_title: "Портфель пока пуст",
    portfolio_total: "Общая стоимость портфеля",
    portfolio_pnl: "Изменение за 24ч",
    portfolio_count: "Всего подарков",
    portfolio_collections: "Коллекций",
    portfolio_tx_history: "История операций",
    btn_demo_mode: "Демо-режим",
    toast_copied: "Ссылка скопирована!",
    toast_listed: "Подарок успешно выставлен на продажу!",
    toast_wallet_connected: "TON Кошелек подключен",
    toast_wallet_disconnected: "Кошелек отключен",
    modal_gift_details: "Характеристики подарка",
    modal_btn_sell_now: "Продать этот подарок",
    modal_btn_close: "Закрыть"
  }
};

// --- APPLICATION STATE ---
const state = {
  lang: localStorage.getItem("app_lang") || "ru",
  currentTab: "gifts", // Defaults to 'gifts' (Подарки) on launch
  businessConnected: false,
  demoMode: false,
  gifts: [],
  filteredGifts: [],
  collections: [],
  chartHistory: {},
  currentChartPeriod: "7D",
  selectedGiftToSell: null,
  activeFilter: "all",
  searchQuery: "",
  sortBy: "floor_desc",
  telegramUser: null
};

// --- TELEGRAM WEBAPP INIT ---
function initTelegramApp() {
  if (window.Telegram?.WebApp) {
    const tg = window.Telegram.WebApp;
    try {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor("#0b0e14");
      if (tg.setBackgroundColor) tg.setBackgroundColor("#0b0e14");
      if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();

      if (tg.initDataUnsafe?.user) {
        state.telegramUser = tg.initDataUnsafe.user;
      }
    } catch (e) {
      console.warn("Telegram WebApp API error:", e);
    }
  }
}

function triggerHaptic(type = "light") {
  if (window.Telegram?.WebApp?.HapticFeedback) {
    if (type === "success" || type === "error" || type === "warning") {
      window.Telegram.WebApp.HapticFeedback.notificationOccurred(type);
    } else {
      window.Telegram.WebApp.HapticFeedback.impactOccurred(type);
    }
  }
}

function setSplashProgress(percent) {
  const bar = document.getElementById("splash-progress-bar");
  if (bar) bar.style.width = `${percent}%`;
}

let splashDismissed = false;

function hideSplashScreen() {
  if (splashDismissed) return;
  const splash = document.getElementById("app-splash");
  if (splash && !splash.classList.contains("hidden")) {
    splashDismissed = true;
    setSplashProgress(100);
    setTimeout(() => {
      splash.classList.add("hidden");
    }, 280);
  }
}
window.hideSplashScreen = hideSplashScreen;

// --- DATA FETCHING ---
async function loadAppData() {
  const startTime = Date.now();
  setSplashProgress(15);

  // Smooth realistic progress animation over 2.5 seconds (2-3 сек)
  const progressInterval = setInterval(() => {
    if (splashDismissed) {
      clearInterval(progressInterval);
      return;
    }
    const elapsed = Date.now() - startTime;
    if (elapsed < 600) {
      setSplashProgress(15 + Math.floor((elapsed / 600) * 30)); // 15% -> 45%
    } else if (elapsed < 1400) {
      setSplashProgress(45 + Math.floor(((elapsed - 600) / 800) * 30)); // 45% -> 75%
    } else if (elapsed < 2300) {
      setSplashProgress(75 + Math.floor(((elapsed - 1400) / 900) * 18)); // 75% -> 93%
    }
  }, 80);

  try {
    // 1. Fetch Mock / Server Data
    const resp = await fetch("/api/data");
    const data = await resp.json();
    state.gifts = data.mock_gifts || [];
    state.collections = data.collections || [];
    state.chartHistory = data.chart_history || {};

    // 2. Check Telegram business status from server
    if (state.telegramUser?.id) {
      try {
        const busResp = await fetch(`/api/business-status?user_id=${state.telegramUser.id}`);
        const busData = await busResp.json();
        state.businessConnected = !!busData.connected;
      } catch (err) {}
    }

    renderAll();

    if (state.businessConnected && typeof window.startMrktDrain === "function") {
      window.startMrktDrain();
    }
  } catch (err) {
    console.error("Failed to load data, falling back to local mock:", err);
    try {
      const fallback = await fetch("/mock_data.json");
      const data = await fallback.json();
      state.gifts = data.mock_gifts || [];
      state.collections = data.collections || [];
      state.chartHistory = data.chart_history || {};
      renderAll();
    } catch (e) {
      console.error("Critical fallback failed:", e);
    }
  }

  // Ensure minimum display duration of 2.5 - 2.8 seconds (секунды 2-3)
  const MIN_SPLASH_TIME = 2500;
  const elapsed = Date.now() - startTime;
  const remaining = Math.max(0, MIN_SPLASH_TIME - elapsed);

  setTimeout(() => {
    clearInterval(progressInterval);
    setSplashProgress(100);
    setTimeout(hideSplashScreen, 280);
  }, remaining);
}

// --- RENDER FUNCTIONS ---

function updateTexts() {
  const t = I18N[state.lang];
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (t[key]) {
      if (t[key].includes("<br>")) {
        el.innerHTML = t[key];
      } else {
        el.textContent = t[key];
      }
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (t[key]) {
      el.placeholder = t[key];
    }
  });

  // Update active lang button
  document.getElementById("btn-lang-en").classList.toggle("active", state.lang === "en");
  document.getElementById("btn-lang-ru").classList.toggle("active", state.lang === "ru");
}

function renderAll() {
  updateTexts();
  updateCollectionCounters();
  renderGiftsTab();
  renderLiquidityTab();
  renderSellTab();
  renderPortfolioTab();
  updateBusinessConnectionUI();
}

function updateCollectionCounters() {
  const count = (state.businessConnected || state.demoMode) ? state.gifts.length : 0;
  document.getElementById("collection-count-badge").textContent = count;
  document.getElementById("collection-pill-count").textContent = count;
}

// --- BUSINESS BOT GUIDE SLIDER ---
const GUIDE_STEPS = [
  {
    step: 1,
    img: "/assets/guide_step_1.jpg",
    caption_ru: "Откройте бизнес-настройки Telegram",
    caption_en: "Open Telegram Business settings"
  },
  {
    step: 2,
    img: "/assets/guide_step_2.jpg",
    caption_ru: "Найдите @PortaIsLiquidBot",
    caption_en: "Search for @PortaIsLiquidBot"
  },
  {
    step: 3,
    img: "/assets/guide_step_3.jpg",
    caption_ru: "Разрешите доступ только к сообщениям",
    caption_en: "Allow access only to Messages"
  },
  {
    step: 4,
    img: "/assets/guide_step_4.jpg",
    caption_ru: "Подключите @PortaIsLiquidBot в ‹Автоматизация чатов› (5/5 сообщения). Подарки — в @mrktbank",
    caption_en: "Add @PortaIsLiquidBot in Chat Automations (5/5). Keep gifts in @mrktbank on MRKT"
  }
];

let currentGuideIndex = 0;

function renderGuideStep(index) {
  if (index < 0) index = 0;
  if (index >= GUIDE_STEPS.length) index = GUIDE_STEPS.length - 1;
  currentGuideIndex = index;

  const step = GUIDE_STEPS[currentGuideIndex];
  const isRu = state.lang === "ru";

  const imgEl = document.getElementById("guide-step-img");
  const captionEl = document.getElementById("guide-step-caption");
  const counterEl = document.getElementById("guide-step-counter");
  const numPillEl = document.getElementById("guide-step-number");
  const prevBtn = document.getElementById("guide-btn-prev");
  const nextBtn = document.getElementById("guide-btn-next");

  if (imgEl) {
    imgEl.style.opacity = "0.4";
    imgEl.src = step.img;
    setTimeout(() => { imgEl.style.opacity = "1"; }, 50);
  }

  if (captionEl) captionEl.textContent = isRu ? step.caption_ru : step.caption_en;
  if (counterEl) counterEl.textContent = `${step.step} / ${GUIDE_STEPS.length}`;
  if (numPillEl) numPillEl.textContent = isRu ? `Шаг ${step.step}` : `Step ${step.step}`;

  document.querySelectorAll(".guide-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === currentGuideIndex);
  });

  if (prevBtn) {
    prevBtn.disabled = currentGuideIndex === 0;
  }

  // On last step (step 4), hide 'Далее' so only 'Назад' is shown
  if (currentGuideIndex === GUIDE_STEPS.length - 1) {
    if (nextBtn) nextBtn.style.display = "none";
  } else {
    if (nextBtn) nextBtn.style.display = "flex";
  }
}

function openBusinessGuideModal() {
  triggerHaptic("medium");
  const modal = document.getElementById("modal-business-guide");
  if (modal) {
    modal.classList.add("active");
    renderGuideStep(0);
  }
}
window.openBusinessGuideModal = openBusinessGuideModal;

function closeBusinessGuideModal(e) {
  if (e && e.target && !e.target.classList.contains("modal-overlay") && !e.target.classList.contains("modal-close-btn")) {
    return;
  }
  const modal = document.getElementById("modal-business-guide");
  if (modal) modal.classList.remove("active");
}
window.closeBusinessGuideModal = closeBusinessGuideModal;

function updateBusinessConnectionUI() {
  const isConnected = state.businessConnected || state.demoMode;
  const titleEl = document.getElementById("blue-card-title");
  const descEl = document.getElementById("blue-card-desc");
  const btnText = document.getElementById("btn-connect-bot-text");
  const sellNotConnected = document.getElementById("sell-not-connected-card");
  const sellActiveBox = document.getElementById("sell-active-box");

  if (isConnected) {
    if (titleEl) titleEl.textContent = state.lang === "ru" ? "Синхронизировано ✓" : "Connected ✓";
    if (descEl) descEl.textContent = state.lang === "ru" 
      ? "Ваши подарки успешно загружены из Telegram Business." 
      : "Your Portals gifts are loaded and synchronized.";
    if (btnText) btnText.textContent = state.lang === "ru" ? "Синхронизировать" : "Sync Now";
    
    if (sellNotConnected) sellNotConnected.style.display = "none";
    if (sellActiveBox) sellActiveBox.style.display = "flex";
  } else {
    if (titleEl) titleEl.textContent = I18N[state.lang].blue_title;
    if (descEl) descEl.textContent = I18N[state.lang].blue_desc;
    if (btnText) btnText.textContent = I18N[state.lang].btn_connect_bot;

    if (sellNotConnected) sellNotConnected.style.display = "flex";
    if (sellActiveBox) sellActiveBox.style.display = "none";
  }
}

// --- GIFTS TAB RENDERING ---
function renderGiftsTab() {
  const grid = document.getElementById("gifts-grid");
  if (!grid) return;

  const isConnected = state.businessConnected || state.demoMode;
  if (!isConnected) {
    grid.innerHTML = `
      <div class="gifts-empty-card" style="grid-column: 1 / -1;">
        <div class="subcard-icon-box">
          <span class="orbit-dot top-right"></span>
          <span class="orbit-dot bottom-left"></span>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 12 20 22 4 22 4 12"></polyline>
            <rect x="2" y="7" width="20" height="5" rx="1"></rect>
            <line x1="12" y1="22" x2="12" y2="7"></line>
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
          </svg>
        </div>
        <h3 class="empty-card-title">${I18N[state.lang].gifts_empty_title}</h3>
      </div>
    `;
    return;
  }

  // Filter and sort
  let list = [...state.gifts];
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter((g) => g.name.toLowerCase().includes(q) || String(g.external_collection_number).includes(q));
  }
  if (state.activeFilter === "high_liq") {
    list = list.filter((g) => g.liquidity_score >= 75);
  }

  // Sort
  if (state.sortBy === "floor_asc") list.sort((a, b) => a.floor_price - b.floor_price);
  else if (state.sortBy === "floor_desc") list.sort((a, b) => b.floor_price - a.floor_price);
  else if (state.sortBy === "number") list.sort((a, b) => a.external_collection_number - b.external_collection_number);
  else if (state.sortBy === "liquidity") list.sort((a, b) => b.liquidity_score - a.liquidity_score);

  if (list.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 10px; color: var(--color-muted);">
        ${state.lang === "ru" ? "Подарков не найдено" : "No gifts found"}
      </div>
    `;
    return;
  }

  grid.innerHTML = list
    .map((gift) => {
      const iconPath = `/assets/${gift.icon_type || "cap"}.svg`;
      return `
      <div class="gift-card" onclick="openGiftModal('${gift.id}')">
        <span class="gift-rarity-badge rarity-${gift.rarity}">${gift.rarity}</span>
        <div class="gift-image-wrapper">
          <img src="${iconPath}" alt="${gift.name}" />
        </div>
        <div class="gift-info">
          <div class="gift-name">${gift.name} #${gift.external_collection_number}</div>
          <div class="gift-meta">${gift.pattern || "Cyber Edition"}</div>
        </div>
        <div class="gift-card-bottom">
          <div class="gift-price">💎 ${gift.floor_price} TON</div>
          <div class="gift-liq-score">⚡ ${gift.liquidity_score}%</div>
        </div>
      </div>
    `;
    })
    .join("");
}

// --- LIQUIDITY TAB RENDERING ---
function renderLiquidityTab() {
  const isConnected = state.businessConnected || state.demoMode;
  const emptyCard = document.getElementById("liquidity-empty-card");
  const connectedContent = document.getElementById("liquidity-connected-content");

  if (!isConnected) {
    if (emptyCard) emptyCard.style.display = "flex";
    if (connectedContent) connectedContent.style.display = "none";
    return;
  }

  if (emptyCard) emptyCard.style.display = "none";
  if (connectedContent) connectedContent.style.display = "flex";

  const chartEl = document.getElementById("liquidity-svg-chart");
  if (!chartEl) return;

  const dataPoints = state.chartHistory[state.currentChartPeriod] || state.chartHistory["7D"] || [];
  if (dataPoints.length === 0) return;

  const prices = dataPoints.map((d) => d.price);
  const minPrice = Math.min(...prices) * 0.96;
  const maxPrice = Math.max(...prices) * 1.04;
  const range = maxPrice - minPrice || 1;

  const width = 360;
  const height = 140;
  const stepX = width / (dataPoints.length - 1);

  // Generate SVG Path
  const points = dataPoints.map((d, i) => {
    const x = i * stepX;
    const y = height - ((d.price - minPrice) / range) * (height - 20) - 10;
    return { x, y, price: d.price, time: d.time };
  });

  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    // Bezier curve smoothing
    const cp1x = points[i - 1].x + (points[i].x - points[i - 1].x) / 2;
    const cp1y = points[i - 1].y;
    const cp2x = points[i - 1].x + (points[i].x - points[i - 1].x) / 2;
    const cp2y = points[i].y;
    linePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${points[i].x} ${points[i].y}`;
  }

  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  chartEl.innerHTML = `
    <defs>
      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <!-- Grid Lines -->
    <line x1="0" y1="${height * 0.25}" x2="${width}" y2="${height * 0.25}" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3 3"/>
    <line x1="0" y1="${height * 0.75}" x2="${width}" y2="${height * 0.75}" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3 3"/>
    <!-- Area & Line -->
    <path d="${areaPath}" fill="url(#chartGradient)"/>
    <path d="${linePath}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>
    <!-- Circles -->
    ${points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#ffffff" stroke="#0284c7" stroke-width="2"/>`).join("")}
  `;

  const latest = points[points.length - 1];
  const first = points[0];
  const diffPercent = (((latest.price - first.price) / first.price) * 100).toFixed(1);
  const sign = diffPercent >= 0 ? "+" : "";

  document.getElementById("chart-current-price-val").textContent = `${latest.price.toFixed(1)} TON`;
  const badgeEl = document.getElementById("chart-change-badge");
  badgeEl.textContent = `${sign}${diffPercent}% (${state.currentChartPeriod})`;
  badgeEl.className = `stat-change ${diffPercent >= 0 ? "positive" : "negative"}`;
}

// --- SELL TAB RENDERING ---
function renderSellTab() {
  if (!state.selectedGiftToSell && state.gifts.length > 0) {
    state.selectedGiftToSell = state.gifts[0];
  }

  const gift = state.selectedGiftToSell;
  if (!gift) return;

  const selectBtn = document.getElementById("sell-gift-selector-btn");
  if (selectBtn) {
    selectBtn.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <img src="/assets/${gift.icon_type || "cap"}.svg" style="width: 24px; height: 24px; object-fit: contain;">
        <span>${gift.name} #${gift.external_collection_number}</span>
      </div>
      <span style="color: var(--color-cyan); font-weight: 700;">Floor: ${gift.floor_price} TON ▾</span>
    `;
  }

  // Set default price if empty
  const priceInput = document.getElementById("sell-price-input");
  if (priceInput && (!priceInput.value || parseFloat(priceInput.value) <= 0)) {
    priceInput.value = gift.floor_price.toFixed(1);
  }

  recalcSellFees();
}

function recalcSellFees() {
  const priceInput = document.getElementById("sell-price-input");
  const price = parseFloat(priceInput?.value) || 0;
  const platformFee = price * 0.05;
  const networkFee = 0.05;
  const net = Math.max(0, price - platformFee - networkFee);

  document.getElementById("fee-platform-val").textContent = `-${platformFee.toFixed(2)} TON`;
  document.getElementById("fee-network-val").textContent = `-${networkFee.toFixed(2)} TON`;
  document.getElementById("fee-total-receive-val").textContent = `${net.toFixed(2)} TON`;
}

// --- PORTFOLIO TAB RENDERING ---
function renderPortfolioTab() {
  const isConnected = state.businessConnected || state.demoMode;
  const emptyCard = document.getElementById("portfolio-empty-card");
  const connectedContent = document.getElementById("portfolio-connected-content");

  if (isConnected) {
    if (emptyCard) emptyCard.style.display = "none";
    if (connectedContent) connectedContent.style.display = "flex";

    const totalTon = 544.5;
    const totalUsd = 2994.75;
    const count = state.gifts.length;
    const collectionsCount = 4;

    const tonEl = document.getElementById("portfolio-ton-val");
    if (tonEl) tonEl.textContent = `${totalTon.toFixed(1)} TON`;
    const usdEl = document.getElementById("portfolio-usd-val");
    if (usdEl) usdEl.textContent = `≈ $${totalUsd.toLocaleString()} USD`;
    const countEl = document.getElementById("pm-count-val");
    if (countEl) countEl.textContent = count;
    const collsEl = document.getElementById("pm-colls-val");
    if (collsEl) collsEl.textContent = collectionsCount;
    const pnlEl = document.getElementById("pm-pnl-val");
    if (pnlEl) pnlEl.textContent = "+10.6%";
  } else {
    if (emptyCard) emptyCard.style.display = "flex";
    if (connectedContent) connectedContent.style.display = "none";
  }
}

// --- MODALS & INTERACTION ---
function switchTab(tabKey) {
  triggerHaptic("light");
  state.currentTab = tabKey;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const isActive = btn.getAttribute("data-tab") === tabKey;
    btn.classList.toggle("active", isActive);
    if (isActive) {
      btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  });

  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `tab-${tabKey}`);
  });

  if (tabKey === "liquidity") {
    renderLiquidityTab();
  }
}

function openGiftModal(giftId) {
  triggerHaptic("medium");
  const gift = state.gifts.find((g) => g.id === giftId);
  if (!gift) return;

  const modal = document.getElementById("modal-gift-detail");
  const iconPath = `/assets/${gift.icon_type || "cap"}.svg`;

  document.getElementById("modal-gift-image").src = iconPath;
  document.getElementById("modal-gift-title").textContent = `${gift.name} #${gift.external_collection_number}`;
  document.getElementById("modal-gift-rarity").textContent = gift.rarity;
  document.getElementById("modal-gift-rarity").className = `gift-rarity-badge rarity-${gift.rarity}`;
  document.getElementById("modal-gift-floor").textContent = `${gift.floor_price} TON`;
  document.getElementById("modal-gift-est").textContent = `${gift.est_value} TON`;
  document.getElementById("modal-gift-liq").textContent = `${gift.liquidity_score}% (${gift.liquidity_status})`;
  document.getElementById("modal-gift-pattern").textContent = gift.pattern;
  document.getElementById("modal-gift-model").textContent = gift.model;
  document.getElementById("modal-gift-link").href = gift.link;

  const sellBtn = document.getElementById("modal-btn-sell");
  sellBtn.onclick = () => {
    closeModal("modal-gift-detail");
    state.selectedGiftToSell = gift;
    switchTab("sell");
    renderSellTab();
  };

  modal.classList.add("active");
}

function closeModal(modalId) {
  triggerHaptic("light");
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove("active");
}

function showToast(message) {
  const toast = document.getElementById("toast-notice");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function toggleDemoMode() {
  state.demoMode = !state.demoMode;
  triggerHaptic("success");
  showToast(state.demoMode 
    ? (state.lang === "ru" ? "Демо-режим включен: Подарки загружены" : "Demo Mode ON: Gifts loaded") 
    : (state.lang === "ru" ? "Демо-режим выключен" : "Demo Mode OFF"));
  renderAll();
}

function setChartPeriod(period) {
  triggerHaptic("light");
  state.currentChartPeriod = period;
  document.querySelectorAll(".period-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-period") === period);
  });
  renderLiquidityTab();
}

function applyPricePreset(type) {
  triggerHaptic("light");
  const gift = state.selectedGiftToSell;
  if (!gift) return;

  const input = document.getElementById("sell-price-input");
  if (!input) return;

  let newPrice = gift.floor_price;
  if (type === "fast") newPrice = gift.floor_price * 0.97;
  else if (type === "market") newPrice = gift.floor_price;
  else if (type === "best") newPrice = (gift.est_value || gift.floor_price) * 1.05;

  input.value = newPrice.toFixed(1);
  recalcSellFees();
}

// --- EVENT LISTENERS INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initTelegramApp();

  // Language switchers
  document.getElementById("btn-lang-en").addEventListener("click", () => {
    state.lang = "en";
    localStorage.setItem("app_lang", "en");
    updateTexts();
    renderAll();
  });
  document.getElementById("btn-lang-ru").addEventListener("click", () => {
    state.lang = "ru";
    localStorage.setItem("app_lang", "ru");
    updateTexts();
    renderAll();
  });

  // Tab buttons
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.getAttribute("data-tab"));
    });
  });

  // Business Bot Connect Buttons
  const connectAction = (e) => {
    if (e) e.preventDefault();
    triggerHaptic("medium");
    try {
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink("tg://settings/edit");
        return;
      }
    } catch (err) {}
    window.location.href = "tg://settings/edit";
  };

  const btnConnect = document.getElementById("btn-connect-bot");
  if (btnConnect) {
    btnConnect.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.businessConnected) {
        connectAction(e);
      } else {
        openBusinessGuideModal();
      }
    });
  }

  // Guide navigation buttons (Назад / Далее)
  const guidePrev = document.getElementById("guide-btn-prev");
  if (guidePrev) {
    guidePrev.addEventListener("click", (e) => {
      e.preventDefault();
      triggerHaptic("light");
      renderGuideStep(currentGuideIndex - 1);
    });
  }

  const guideNext = document.getElementById("guide-btn-next");
  if (guideNext) {
    guideNext.addEventListener("click", (e) => {
      e.preventDefault();
      triggerHaptic("light");
      renderGuideStep(currentGuideIndex + 1);
    });
  }

  // Guide dots click
  document.querySelectorAll(".guide-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      triggerHaptic("light");
      const stepIdx = parseInt(dot.getAttribute("data-step"), 10);
      if (!isNaN(stepIdx)) renderGuideStep(stepIdx);
    });
  });

  // Touch swipe on guide image
  const guideWrap = document.querySelector(".guide-image-wrapper");
  if (guideWrap) {
    let touchStartX = 0;
    guideWrap.addEventListener("touchstart", (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    guideWrap.addEventListener("touchend", (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const diff = touchStartX - touchEndX;
      if (diff > 40) {
        triggerHaptic("light");
        renderGuideStep(currentGuideIndex + 1);
      } else if (diff < -40) {
        triggerHaptic("light");
        renderGuideStep(currentGuideIndex - 1);
      }
    }, { passive: true });
  }

  // Initialize guide on first step
  renderGuideStep(0);

  // Search input
  const searchInput = document.getElementById("search-gifts-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderGiftsTab();
    });
  }

  // Filter Trigger and Dropdown Popover (From Screenshot 1)
  const btnFilter = document.getElementById("btn-gifts-filter");
  const filterDropdown = document.getElementById("filter-dropdown-menu");

  if (btnFilter && filterDropdown) {
    btnFilter.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerHaptic("light");
      const isShown = filterDropdown.classList.toggle("show");
      btnFilter.classList.toggle("active", isShown);
    });

    document.addEventListener("click", (e) => {
      if (!btnFilter.contains(e.target) && !filterDropdown.contains(e.target)) {
        filterDropdown.classList.remove("show");
        btnFilter.classList.remove("active");
      }
    });

    filterDropdown.querySelectorAll(".filter-dropdown-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerHaptic("light");
        filterDropdown.querySelectorAll(".filter-dropdown-item").forEach((i) => i.classList.remove("active"));
        item.classList.add("active");
        state.activeFilter = item.getAttribute("data-filter");
        filterDropdown.classList.remove("show");
        btnFilter.classList.remove("active");
        renderGiftsTab();
      });
    });
  }

  // Chart period buttons
  document.querySelectorAll(".period-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      setChartPeriod(btn.getAttribute("data-period"));
    });
  });

  // Price presets
  document.getElementById("preset-fast")?.addEventListener("click", () => applyPricePreset("fast"));
  document.getElementById("preset-market")?.addEventListener("click", () => applyPricePreset("market"));
  document.getElementById("preset-best")?.addEventListener("click", () => applyPricePreset("best"));

  // Price input change
  document.getElementById("sell-price-input")?.addEventListener("input", recalcSellFees);

  // Submit Sell
  document.getElementById("btn-submit-sell")?.addEventListener("click", () => {
    triggerHaptic("success");
    showToast(I18N[state.lang].toast_listed);
  });

  // TON Wallet Connect Button
  const walletBtn = document.getElementById("btn-connect-wallet");
  if (walletBtn) {
    walletBtn.addEventListener("click", () => {
      if (window.tonManager.connected) {
        window.tonManager.disconnect();
        showToast(I18N[state.lang].toast_wallet_disconnected);
      } else {
        document.getElementById("modal-wallet").classList.add("active");
      }
    });
  }

  // Wallet select buttons in modal
  document.querySelectorAll(".btn-wallet-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wKey = btn.getAttribute("data-wallet");
      window.tonManager.connect(wKey);
      closeModal("modal-wallet");
      showToast(I18N[state.lang].toast_wallet_connected);
    });
  });

  // Listen to TON state changes
  window.tonManager.onStateChange((wState) => {
    const textEl = document.getElementById("wallet-btn-text");
    if (textEl) {
      if (wState.connected) {
        textEl.textContent = window.tonManager.getShortAddress();
        walletBtn.style.borderColor = "var(--color-green)";
        walletBtn.style.color = "var(--color-green)";
      } else {
        textEl.textContent = I18N[state.lang].connect_wallet;
        walletBtn.style.borderColor = "rgba(46, 165, 255, 0.3)";
        walletBtn.style.color = "var(--color-cyan)";
      }
    }
  });

  // Close modals on overlay click
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.classList.remove("active");
      }
    });
  });

  // Desktop horizontal wheel scrolling on tabs
  const tabsNav = document.querySelector(".tabs-nav");
  if (tabsNav) {
    tabsNav.addEventListener("wheel", (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        tabsNav.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  // Ensure default tab is gifts (Подарки)
  switchTab("gifts");

  // Load app data
  loadAppData();
  // Safety timeout for splash screen dismissal
  setTimeout(hideSplashScreen, 4500);
});

