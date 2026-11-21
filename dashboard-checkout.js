"use strict";
(() => {
  const grid = document.getElementById("catalog-grid");
  const countryInput = document.getElementById("catalog-country");
  const searchInput = document.getElementById("catalog-search");
  if (!grid) return;

  let catalogue = null;
  let signedIn = false;
  let selected = null;
  const checkoutReturnParams = new URLSearchParams(window.location.search);
  const requestedProductKey = checkoutReturnParams.get("selectProduct") || "";
  const requestedProductCategory = checkoutReturnParams.get("category") || "all";
  let requestedProductHandled = false;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const money = cents => {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100); }
    catch { return "USD " + (Number(cents) / 100).toFixed(2); }
  };

document.body.insertAdjacentHTML("beforeend", `
    <dialog id="vf-checkout-dialog" class="vf-checkout-dialog" aria-labelledby="vf-checkout-title">
      <form id="vf-checkout-form">
        <div class="vf-checkout-head"><div><span class="catalog-eyebrow">SECURE CHECKOUT</span><h2 id="vf-checkout-title">Review your order</h2></div><button type="button" id="vf-checkout-close" aria-label="Close checkout">×</button></div>
        <p id="vf-checkout-product" class="vf-checkout-product"></p>
        <div class="vf-checkout-price"><span>Estimated total</span><strong id="vf-checkout-price">—</strong></div>
        <fieldset class="vf-payment-choice">
          <legend>How would you like to pay?</legend>
          <label><input type="radio" name="vf-payment-method" value="wallet"> <span>Pay from my VerifyFlow wallet <small id="vf-wallet-balance" class="vf-wallet-balance">Checking wallet balance…</small></span></label>
          <label><input type="radio" name="vf-payment-method" value="squad" checked> <span>Pay with Squad <small>Card, bank, USSD or bank transfer</small></span></label>
          <label><input type="radio" name="vf-payment-method" value="monnify"> <span>Pay with Monnify <small>Existing payment option</small></span></label>
          <a href="/account.html?panel=wallet" class="account-text-link">Fund your wallet ↗</a>
        </fieldset>
        <p class="vf-checkout-note">The final price is confirmed using a fresh supplier quote before payment.</p>
        <label id="vf-duration-wrap" class="catalog-duration" hidden>Rental period<select id="vf-duration-select"></select></label>
        <label id="vf-herosms-method-wrap" class="catalog-duration" hidden>Verification method<select id="vf-herosms-method-select"><option value="sms">SMS</option></select></label>
        <p class="vf-checkout-note">Catalogue prices are shown in USD. Squad checkout supports card, bank, USSD and transfer. VerifyFlow converts USD prices to NGN using its configured rate for local payments. Taxes are not included.</p>
        <p id="vf-checkout-message" class="vf-checkout-message" role="status" aria-live="polite"></p>
        <button id="vf-checkout-submit" class="vf-buy-button" type="submit">Continue to secure payment ↗</button>
      </form>
    </dialog>
  `);
  const dialog = document.getElementById("vf-checkout-dialog");
  const form = document.getElementById("vf-checkout-form");
  const message = document.getElementById("vf-checkout-message");
  const submit = document.getElementById("vf-checkout-submit");
  const walletBalanceLabel = document.getElementById("vf-wallet-balance");
  let walletBalanceMinor = null;
  async function refreshWalletBalance() {
    if (!signedIn) {
      walletBalanceLabel.textContent = "Sign in to use wallet funds.";
      walletBalanceMinor = null;
      return;
    }
    try {
      const response = await fetch("/api/wallet", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Wallet unavailable.");
      walletBalanceMinor = Number(data.wallet?.balanceMinor || 0);
      walletBalanceLabel.textContent = "Available: " + money(walletBalanceMinor);
    } catch {
      walletBalanceMinor = null;
      walletBalanceLabel.textContent = "Wallet balance could not be loaded. Squad checkout is available.";
    }
  }

  function key() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID().replaceAll("-", "");
    return "vf" + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function visibleRows(category) {
    const section = catalogue?.sections?.[category];
    const rows = Array.isArray(section?.items) ? section.items : [];
    const query = String(searchInput?.value || "").trim().toLowerCase();
    const labels = { sms:"sms verification", rentals:"long-term numbers", esim:"esim data", proxies:"mobile proxies", dedicated:"dedicated numbers", marketing:"marketing services" };
    return query ? rows.filter(item => JSON.stringify(item).toLowerCase().includes(query) || (labels[category]||"").includes(query)) : rows;
  }

  function productDetails(category, item) {
    if (category === "sms") return { type: "sms_otp", id: item.id, available: item.available === true, price: item.priceCents, supportsVerificationMethods: item.supportsVerificationMethods === true };
    if (category === "rentals") { const durations = (item.durations || []).filter(x => Number.isSafeInteger(Number(x.priceCents)) && Number(x.priceCents) > 0).map(x => ({ days: Number(x.days), price: Number(x.priceCents) })); return { type: "long_term_number", id: item.id, available: item.available === true, price: Math.min(...durations.map(x => x.price)), durations }; }
    if (category === "esim") return { type: "esim", id: item.id, available: true, price: item.priceCents };
    if (category === "proxies") return { type: "mobile_proxy", id: item.id, available: item.available !== false, price: item.priceCents, planType: String(item.type || "shared").toLowerCase() };
    if (category === "dedicated") return { type: "dedicated_number", id: item.id, available: item.inStock === true, price: item.priceCents };
    if (category === "marketing") return { type: "smm_service", id: item.id, available: true, price: item.pricePer1000Minor, min: item.min, max: item.max };
    return null;
  }

  function renderButtons() {
    // Cards carry the exact catalogue row used to render them; checkout must
    // not depend on a second catalogue request completing successfully.
    const cards = [...grid.querySelectorAll(".catalog-item")];
    cards.forEach(card => {
      if (card.querySelector(".vf-buy-area")) return;
      const category = card.dataset.productCategory || "sms";
      const key = card.dataset.productKey || "";
      // Prefer the row embedded in the card that the customer actually sees.
      // The API seals product tokens with a fresh nonce on each response, so
      // looking up a card token in a second /api/catalog response can never be
      // reliable even when both responses contain the same supplier product.
      let item = null;
      try {
        if (card.dataset.productJson) item = JSON.parse(card.dataset.productJson);
      } catch { item = null; }
      if (!item) {
        item = visibleRows(category).find(row =>
          String(row.id??row.productId??row.country??row.title??row.name??row.full_title??"") === key
        );
      }
      if (!item) return;
      const product = productDetails(category, item);
      if (!product) {
        return;
      }
      if (!product.id || !Number.isSafeInteger(Number(product.price)) || Number(product.price) <= 0) return;
      const durations = product.durations || [];
      if (category === "proxies") {
        let proxyOptions = [];
        try { proxyOptions = JSON.parse(card.dataset.proxyOptions || "[]"); } catch { proxyOptions = []; }
        if (proxyOptions.length > 0) {
          const shared = product.planType === "shared";
          const area = document.createElement("div");
          area.className = "vf-buy-area vf-proxy-buy-area";
          area.innerHTML = '<label class="vf-rental-price">' + (shared ? 'Choose data package' : 'Choose rental period') +
            '<select data-proxy-duration>' +
            proxyOptions.map((option,index) => {
              const size = Number(option.dataGb) > 0 ? option.dataGb + ' GB' : '';
              const days = Number(option.durationDays) || 0;
              const term = days ? days + ' days' : (option.period || 'Plan term');
              const label = shared ? size + (term ? ' · ' + term + ' validity' : '') : term;
              return '<option value="' + index + '">' + esc(label) +
                (Number(option.discountPercent)>0 ? ' · Save ' + esc(option.discountPercent) + (shared ? '% per GB' : '% per day') +
                  ' vs ' + esc(option.discountBasis || (shared ? 'entry-level package' : 'daily term')) : '') +
                '</option>';
            }).join("") +
            '</select><small data-proxy-price-summary></small></label>' +
            '<button class="vf-buy-button" type="button" data-vf-buy="true" data-product-type="mobile_proxy" data-product-id="' +
            esc(proxyOptions[0].id) + '" data-product-name="' + esc(item.name || "Mobile proxy") +
            '" data-product-price="' + esc(proxyOptions[0].priceCents) + '">Continue to checkout →</button>';
          card.querySelector(".catalog-item-copy")?.appendChild(area);
          const select = area.querySelector("[data-proxy-duration]");
          const buy = area.querySelector("[data-vf-buy]");
          const rateLabel = card.querySelector(".catalog-price-row strong");
          const priceNote = card.querySelector(".catalog-price-row small");
          const applyProxyTerm = () => {
            const option = proxyOptions[Number(select.value)] || proxyOptions[0];
            if (!option) return;
            const days = Number(option.durationDays) || 0;
            const durationLabel = days ? days + " days" : (option.period || "Selected term");
            const dataGb = Number(option.dataGb) || 0;
            const perGb = Number(option.pricePerGbCents || 0);
            const perDay = Number(option.pricePerDayCents || 0);
            const total = Number(option.priceCents || 0);
            const discount = Number(option.discountPercent || 0);
            const unitRate = shared ? perGb : perDay;
            buy.dataset.productId = option.id;
            buy.dataset.productPrice = String(total);
            buy.dataset.productName = shared
              ? "Shared Mobile Proxy · " + dataGb + " GB"
              : "Dedicated Mobile Proxy · " + durationLabel;
            if (rateLabel) rateLabel.textContent = money(shared && perGb > 0 ? perGb : total);
            if (priceNote) priceNote.textContent = shared
              ? "PER GB · " + dataGb + " GB package · " + durationLabel + " validity · total " + money(total) +
                (discount > 0 ? " · Save " + discount + "% per GB vs " + (option.discountBasis || "entry-level package") : "") + " · before VAT/tax"
              : "UNLIMITED TRAFFIC · total " + money(total) + " for " + durationLabel +
                (perDay > 0 ? " · effective " + money(perDay) + " per day" : "") +
                (discount > 0 ? " · Save " + discount + "% per day vs " + (option.discountBasis || "daily term") : "") + " · before VAT/tax";
            const summary = area.querySelector("[data-proxy-price-summary]");
            if (summary) summary.textContent = shared
              ? money(perGb) + " per GB · " + dataGb + " GB total package: " + money(total) +
                (discount > 0 ? " · " + discount + "% lower per GB vs " + (option.discountBasis || "entry-level package") : "")
              : money(total) + " total · " + money(unitRate) + " per day equivalent · " + durationLabel +
                (discount > 0 ? " · " + discount + "% lower per day than the daily term" : "");
          };
          select.addEventListener("change",applyProxyTerm);
          applyProxyTerm();
          return;
        }
      }
      if (category === "marketing") {
        const min = Number(product.min), max = Number(product.max);
        const area = document.createElement("div");
        area.className = "vf-buy-area vf-smm-buy-area";
        area.innerHTML = '<label>Target profile or post URL<input type="url" data-smm-link required placeholder="https://www.tiktok.com/@name/video/..."></label>' +
          '<label>Quantity (min ' + esc(min) + ' · max ' + esc(max) + ')<input type="number" data-smm-quantity min="' + esc(min) + '" max="' + esc(max) + '" step="1" value="' + esc(min) + '" required></label>' +
          '<div class="vf-smm-live-total" aria-live="polite"><span>Estimated total</span><strong data-smm-total>' + esc(money(Math.ceil(Number(product.price) * min / 1000))) + '</strong></div>' +
          '<button class="vf-buy-button" type="button" data-vf-buy="true" data-product-type="smm_service" data-product-id="' + esc(product.id) + '" data-product-name="' + esc(item.name || "Social media service") + '" data-product-price="' + esc(product.price) + '" data-min="' + esc(min) + '" data-max="' + esc(max) + '">Continue to checkout →</button>';
        card.querySelector(".catalog-item-copy")?.appendChild(area);
        const quantityInput = area.querySelector("[data-smm-quantity]");
        quantityInput.addEventListener("input", () => {
          const quantity = Number(quantityInput.value);
          const valid = Number.isSafeInteger(quantity) && quantity >= min && quantity <= max;
          const totalLabel=area.querySelector("[data-smm-total]");
          totalLabel.textContent = valid
            ? money(Math.ceil(Number(product.price) * quantity / 1000))
            : "Enter a quantity between " + min + " and " + max + ".";
        });
        return;
      }
      const cheapestDuration = durations.length ? durations.reduce((best, option) => option.price < best.price ? option : best, durations[0]) : null;
      const select = category === "rentals" && durations.length
        ? '<label class="vf-rental-price">Rental period<select aria-label="Choose rental period" data-rental-days>' + durations.map(option => '<option value="' + esc(option.days) + '"' + (option.days === cheapestDuration.days ? " selected" : "") + '>' + esc(option.days) + ' days</option>').join("") + '</select><small data-rental-selected-price>Selected period: ' + esc(money(cheapestDuration.price)) + ' for ' + esc(cheapestDuration.days) + ' days</small></label>'
        : "";
      const button = '<button class="vf-buy-button" type="button" data-vf-buy="true" ' +
        'data-product-type="' + esc(product.type) + '" data-product-id="' + esc(product.id) + '" ' +
        'data-product-name="' + esc(item.title || item.name || item.full_title || item.country || "VerifyFlow service") + '" ' +
        'data-product-price="' + esc(product.price) + '" data-herosms-methods="' + (product.supportsVerificationMethods ? "true" : "false") + '" data-duration-prices="' + esc(JSON.stringify(durations)) + '"' + (product.available && durations.length !== 0 || product.available && category !== "rentals" ? "" : " disabled") +
        '>Continue to checkout →</button>';
      card.querySelector(".catalog-item-copy")?.insertAdjacentHTML("beforeend", '<div class="vf-buy-area">' + select + button + '</div>');
      if (category === "rentals" && cheapestDuration) {
        const durationSelect = card.querySelector("[data-rental-days]");
        const updateRentalPrice = () => {
          const chosen = durations.find(option => option.days === Number(durationSelect.value));
          if (!chosen) return;
          const price = card.querySelector(".catalog-price-row strong");
          const note = card.querySelector(".catalog-price-row small");
          const selectedLabel = card.querySelector("[data-rental-selected-price]");
          if (price) price.textContent = money(chosen.price);
          if (note) note.textContent = "for " + chosen.days + " days · before VAT/tax";
          if (selectedLabel) selectedLabel.textContent = "Selected period: " + money(chosen.price) + " for " + chosen.days + " days";
        };
        durationSelect.addEventListener("change", updateRentalPrice);
        updateRentalPrice();
      }
    });
    tryOpenRequestedProduct();
  }

  function clearRequestedProductFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("selectProduct");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function tryOpenRequestedProduct() {
    if (!requestedProductKey || requestedProductHandled) return;
    const card = [...grid.querySelectorAll(".catalog-item")].find(item =>
      item.dataset.productCategory === requestedProductCategory &&
      item.dataset.productKey === requestedProductKey
    );
    if (!card) return;
    requestedProductHandled = true;
    clearRequestedProductFromUrl();
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    if (requestedProductCategory === "marketing") {
      const target = card.querySelector("[data-smm-link]");
      if (target) target.focus({ preventScroll: true });
      const status = document.getElementById("catalog-status");
      if (status) status.textContent = "Your selected service is ready. Add the public target link and quantity to continue to checkout.";
      return;
    }
    const buyButton = card.querySelector("[data-vf-buy]");
    if (buyButton && !buyButton.disabled) {
      buyButton.click();
    } else {
      const status = document.getElementById("catalog-status");
      if (status) status.textContent = "Your selected listing is currently unavailable. Choose another available option.";
    }
  }

  async function loadMarketingCatalogue() {
    try {
      const response = await fetch("/api/marketing-catalog", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Social media catalogue unavailable.");
      catalogue.sections = catalogue.sections || {};
      catalogue.sections.marketing = { ok: true, items: Array.isArray(data.items) ? data.items : [] };
    } catch {
      catalogue.sections = catalogue.sections || {};
      catalogue.sections.marketing = { ok: false, items: [] };
    }
    renderButtons();
  }

  async function loadCatalogue() {
    const country = String(countryInput?.value || "US").trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(country)) return;
    if (countryInput) countryInput.disabled = false;
    try {
      const response = await fetch("/api/catalog?country=" + country, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || !data.sections) throw new Error("Catalogue unavailable");
      catalogue = data;
      await loadMarketingCatalogue();
      renderButtons();
    } catch {
      catalogue = null;
    }
  }

  const sessionReady = fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
    .then(response => response.json()).then(data => { signedIn = Boolean(data.ok && data.user); }).catch(() => { signedIn = false; });

  function activateServiceCard(card) {
    if (!card) return;
    // Ensure the asynchronous checkout controls exist before trying to activate a card.
    try { renderButtons(); } catch {}
    const targetInput = card.querySelector("[data-smm-link]");
    if (targetInput) {
      targetInput.focus();
      targetInput.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const openBuyDialog = () => {
      const smmLink = card.querySelector("[data-smm-link]");
      if (smmLink) {
        smmLink.focus();
        smmLink.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
      }
      const buyButton = card.querySelector("[data-vf-buy]");
      if (!buyButton) return false;
      if (buyButton.disabled) {
        const status = document.getElementById("catalog-status");
        if (status) status.textContent = "This option is currently unavailable. Please choose another available listing.";
        return true;
      }
      buyButton.click();
      return true;
    };
    if (openBuyDialog()) return;
    if (card.dataset.vfActivationPending === "true") return;
    card.dataset.vfActivationPending = "true";
    const status = document.getElementById("catalog-status");
    if (status) status.textContent = "Preparing secure options for this service…";
    let attempts = 0;
    const retry = () => {
      if (!card.isConnected) return;
      if (openBuyDialog()) {
        delete card.dataset.vfActivationPending;
        return;
      }
      attempts += 1;
      if (attempts >= 40) {
        delete card.dataset.vfActivationPending;
        if (status) status.textContent = "This listing is still loading. Refresh the catalogue and try again.";
        return;
      }
      window.setTimeout(retry, 125);
    };
    window.setTimeout(retry, 125);
  }

  grid.addEventListener("click", async event => {
    const cardAction = event.target.closest("[data-vf-card-open]");
    if (cardAction) {
      event.preventDefault();
      activateServiceCard(cardAction.closest(".catalog-item"));
      return;
    }
    let button = event.target.closest("[data-vf-buy]");
    if (!button) {
      const cardTile = event.target.closest(".catalog-item");
      if (!cardTile || event.target.closest("button,a,input,select,textarea,label")) return;
      activateServiceCard(cardTile);
      return;
    }
    if (button.disabled) return;
    await sessionReady;
    if (!signedIn) {
      const card = button.closest(".catalog-item");
      const returnUrl = new URL("/dashboard.html", window.location.origin);
      returnUrl.searchParams.set("category", card?.dataset.productCategory || "all");
      if (card?.dataset.productKey) returnUrl.searchParams.set("selectProduct", card.dataset.productKey);
      if (countryInput?.value) returnUrl.searchParams.set("country", countryInput.value);
      returnUrl.hash = "catalogue";
      const accountUrl = new URL("/account.html", window.location.origin);
      accountUrl.searchParams.set("returnTo", returnUrl.pathname + returnUrl.search + returnUrl.hash);
      window.location.assign(accountUrl.toString());
      return;
    }
    await refreshWalletBalance();
    const card = button.closest(".catalog-item");
    const productType = button.dataset.productType;
    let smmTargetUrl = "", smmQuantity = 0;
    if (productType === "smm_service") {
      const linkInput = card?.querySelector("[data-smm-link]");
      const quantityInput = card?.querySelector("[data-smm-quantity]");
      if (!linkInput?.reportValidity() || !quantityInput?.reportValidity()) return;
      try {
        const target = new URL(linkInput.value.trim());
        if (!["https:", "http:"].includes(target.protocol)) throw new Error("invalid");
        smmTargetUrl = target.toString();
      } catch {
        linkInput.setCustomValidity("Enter a valid public profile or content URL.");
        linkInput.reportValidity();
        linkInput.addEventListener("input", () => linkInput.setCustomValidity(""), { once: true });
        return;
      }
      smmQuantity = Number(quantityInput.value);
      if (!Number.isSafeInteger(smmQuantity) || smmQuantity < Number(button.dataset.min) || smmQuantity > Number(button.dataset.max)) {
        quantityInput.setCustomValidity("Choose a quantity within the supplier limits.");
        quantityInput.reportValidity();
        quantityInput.addEventListener("input", () => quantityInput.setCustomValidity(""), { once: true });
        return;
      }
    }
    selected = {
      productType,
      productId: button.dataset.productId,
      productName: button.dataset.productName || "VerifyFlow service",
      estimate: productType === "smm_service"
        ? Math.ceil(Number(button.dataset.productPrice) * smmQuantity / 1000)
        : Number(button.dataset.productPrice),
      targetUrl: smmTargetUrl,
      quantity: smmQuantity,
      durationPrices: JSON.parse(button.dataset.durationPrices || "[]"),
      checkoutKey: key(),
      durationDays: Number(card?.querySelector("[data-rental-days]")?.value || 0),
      supportsVerificationMethods: button.dataset.herosmsMethods === "true",
      verificationType: "sms"
    };
    if (productType === "smm_service") selected.productName += " · " + smmQuantity.toLocaleString() + " units";
    if (selected.productType === "long_term_number") {
      const chosen = selected.durationPrices.find(item => item.days === selected.durationDays);
      if (chosen) selected.estimate = chosen.price;
    }
    document.getElementById("vf-checkout-product").textContent = selected.productName;
    document.getElementById("vf-checkout-price").textContent = money(selected.estimate);
    message.textContent = "";
    const wrap = document.getElementById("vf-duration-wrap");
    const select = document.getElementById("vf-duration-select");
    if (selected.productType === "long_term_number") {
      const days = [...(card?.querySelectorAll("[data-rental-days] option") || [])].map(option => option.value);
      select.innerHTML = days.map(day => '<option value="' + esc(day) + '">' + esc(day) + ' days</option>').join("");
      select.value = String(selected.durationDays || days[0] || "");
      wrap.hidden = false;
    } else {
      select.innerHTML = "";
      wrap.hidden = true;
    }
    const methodWrap = document.getElementById("vf-herosms-method-wrap");
    const methodSelect = document.getElementById("vf-herosms-method-select");
    methodWrap.hidden = !selected.supportsVerificationMethods;
    methodSelect.innerHTML = '<option value="sms">SMS · checking options…</option>';
    selected.heroSmsMethods = [];
    selected.heroSmsOffersReady = !selected.supportsVerificationMethods;
    methodSelect.disabled = false;
    if (selected.supportsVerificationMethods) {
      methodWrap.hidden = false;
      methodSelect.innerHTML = '<option value="">Loading available methods…</option>';
      const activeSelection = selected;
      fetch("/api/herosms/offers?productId=" + encodeURIComponent(selected.productId), { credentials: "same-origin", cache: "no-store" })
        .then(async response => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.ok || !Array.isArray(data.methods) || !data.methods.length) {
            throw new Error(data.error || "No verification methods are currently available.");
          }
          if (selected !== activeSelection) return;
          selected.heroSmsMethods = data.methods;
          selected.heroSmsOffersReady = true;
          methodSelect.innerHTML = data.methods.map(method =>
            '<option value="' + esc(method.type) + '">' + esc(method.label) + ' · ' + esc(money(method.priceCents)) + '</option>'
          ).join("");
          selected.verificationType = methodSelect.value;
          selected.estimate = Number(data.methods[0].priceCents);
          document.getElementById("vf-checkout-price").textContent = money(selected.estimate);
          message.textContent = "";
        })
        .catch(error => {
          if (selected !== activeSelection) return;
          selected.heroSmsOffersReady = false;
          methodSelect.disabled = true;
          methodSelect.innerHTML = '<option value="">Verification options unavailable</option>';
          message.textContent = (error.message || "Could not load HeroSMS verification options.") + " Please close checkout and refresh the catalogue before paying.";
        });
    }
    dialog.showModal();
  });

  grid.addEventListener("keydown", event => {
    const tile = event.target.closest(".catalog-item[tabindex='0']");
    if (!tile || event.target !== tile || !["Enter"," "].includes(event.key)) return;
    event.preventDefault();
    activateServiceCard(tile);
  });

  document.getElementById("vf-duration-select").addEventListener("change", event => {
    if (!selected || selected.productType !== "long_term_number") return;
    selected.durationDays = Number(event.target.value);
    const chosen = selected.durationPrices.find(item => item.days === selected.durationDays);
    if (chosen) {
      selected.estimate = chosen.price;
      document.getElementById("vf-checkout-price").textContent = money(chosen.price);
    }
  });
  document.getElementById("vf-checkout-close").addEventListener("click", () => dialog.close());
  document.getElementById("vf-herosms-method-select").addEventListener("change", event => {
    if (!selected) return;
    selected.verificationType = event.target.value;
    const chosen = (selected.heroSmsMethods || []).find(method => method.type === selected.verificationType);
    if (chosen) {
      selected.estimate = Number(chosen.priceCents);
      document.getElementById("vf-checkout-price").textContent = money(selected.estimate);
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!selected) return;
    if (selected.supportsVerificationMethods && !selected.heroSmsOffersReady) {
      message.textContent = "HeroSMS verification options have not loaded. Please refresh the catalogue and try again; no payment has been started.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Preparing secure checkout…";
    message.textContent = "";
    const paymentMethod = form.querySelector('input[name="vf-payment-method"]:checked')?.value || "squad";
    if (paymentMethod === "wallet" && walletBalanceMinor != null && walletBalanceMinor < selected.estimate) {
      message.textContent = "Your wallet balance is too low. Fund your wallet or choose Squad.";
      submit.disabled = false;
      submit.textContent = "Continue to payment ↗";
      return;
    }
    const payload = {
      checkoutKey: selected.checkoutKey,
      productType: selected.productType,
      productId: selected.productId,
      paymentMethod,
      ...(selected.supportsVerificationMethods ? { verificationType: selected.verificationType || "sms" } : {})
    };
    if (selected.productType === "long_term_number") payload.durationDays = Number(document.getElementById("vf-duration-select").value);
    if (selected.productType === "smm_service") {
      payload.targetUrl = selected.targetUrl;
      payload.quantity = selected.quantity;
    }
    try {
      const response = await fetch("/api/orders/create", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { window.location.href = "/account.html"; return; }
      if (!response.ok || !data.ok) {
        if (response.status === 502) selected.checkoutKey = key();
        throw new Error(data.error || "Secure checkout could not be prepared.");
      }
      if (data.walletPaid) {
        message.textContent = "Paid from your wallet. Your order " + (data.orderNumber || "") + " has been created.";
        submit.textContent = "Paid from wallet ✓";
        submit.disabled = true;
        await refreshWalletBalance();
        window.setTimeout(() => window.location.assign("/account.html?panel=orders"), 900);
        return;
      }
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      message.textContent = error.message || "Please try again.";
      submit.disabled = false;
      submit.textContent = "Try payment again ↗";
    }
  });

  const observer = new MutationObserver(() => renderButtons());
  observer.observe(grid, { childList: true });
  document.querySelectorAll("[data-catalog-tab]").forEach(tab => tab.addEventListener("click", () => {
    window.setTimeout(renderButtons, 0);
  }));
  searchInput?.addEventListener("input", () => window.setTimeout(renderButtons, 0));
  document.getElementById("vf-dash-search")?.addEventListener("input", () => window.setTimeout(renderButtons, 0));
  countryInput?.addEventListener("change", loadCatalogue);
  document.getElementById("catalog-refresh")?.addEventListener("click", () => window.setTimeout(loadCatalogue, 300));
  loadCatalogue();
})();
