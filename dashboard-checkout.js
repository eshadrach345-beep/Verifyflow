"use strict";
(() => {
  const grid = document.getElementById("catalog-grid");
  const countryInput = document.getElementById("catalog-country");
  const searchInput = document.getElementById("catalog-search");
  if (!grid) return;

  let catalogue = null;
  let signedIn = false;
  let selected = null;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const money = cents => {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100); }
    catch { return "USD " + (Number(cents) / 100).toFixed(2); }
  };

  const style = document.createElement("style");
  style.textContent = `
    .vf-buy-area{display:grid;gap:8px;margin-top:13px}
    .vf-buy-area select,.vf-buy-area input{width:100%;border:1px solid #c8d0d2;border-radius:7px;padding:9px;background:#fff;color:#111;font:500 13px Inter,Arial}
    .vf-smm-buy-area label{display:grid;gap:5px;font:600 12px/1.4 Inter,Arial;color:#42515c}
    .vf-smm-buy-area small{font:700 12px Inter,Arial;color:#08767c}
    .vf-buy-button{width:100%;border:1px solid #e2ba00;border-radius:22px;background:#ffd814;color:#111;padding:11px 13px;font:800 13px Inter,Arial;cursor:pointer}
    .vf-buy-button:disabled{opacity:.5;cursor:not-allowed}
    .vf-checkout-dialog{width:min(520px,calc(100% - 24px));border:1px solid #d5d9d9;border-radius:12px;padding:22px;color:#0f1111;box-shadow:0 18px 60px #0004}
    .vf-checkout-dialog::backdrop{background:#13192199}
    .vf-checkout-dialog form{display:grid;gap:14px}
    .vf-checkout-head{display:flex;justify-content:space-between;align-items:center}
    .vf-checkout-head h2{font:800 23px Inter,Arial;margin:5px 0}
    .vf-checkout-head button{border:0;background:#f2f4f4;border-radius:50%;width:34px;height:34px;font-size:22px;cursor:pointer}
    .vf-checkout-price{display:flex;justify-content:space-between;align-items:center;padding:13px 0;border-top:1px solid #e8ebed;border-bottom:1px solid #e8ebed}
    .vf-checkout-price strong{font-size:22px}
    .vf-checkout-note{font:400 12px/1.6 Inter,Arial;color:#66727b;margin:0}
    .vf-payment-choice{border:1px solid #e1e7e8;border-radius:9px;padding:12px;display:grid;gap:9px}
    .vf-payment-choice legend{font:800 13px Inter,Arial;padding:0 5px}
    .vf-payment-choice label{display:flex;gap:9px;align-items:flex-start;font:600 13px/1.45 Inter,Arial;color:#26343d}
    .vf-payment-choice input{margin:2px 0 0;accent-color:#08767c}
    .vf-wallet-balance{font:700 12px Inter,Arial;color:#08767c}
    .vf-rental-price{font:700 12px/1.45 Inter,Arial;color:#08767c}
    .vf-checkout-message{font:600 13px/1.5 Inter,Arial;color:#a33b2b;margin:0}
    @media(max-width:600px){.vf-checkout-dialog{padding:17px}.vf-checkout-head h2{font-size:20px}.vf-buy-button{font-size:12px}}
  `;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="vf-checkout-dialog" class="vf-checkout-dialog" aria-labelledby="vf-checkout-title">
      <form id="vf-checkout-form">
        <div class="vf-checkout-head"><div><span class="catalog-eyebrow">SECURE CHECKOUT</span><h2 id="vf-checkout-title">Review your order</h2></div><button type="button" id="vf-checkout-close" aria-label="Close checkout">×</button></div>
        <p id="vf-checkout-product" class="vf-checkout-product"></p>
        <div class="vf-checkout-price"><span>Estimated total</span><strong id="vf-checkout-price">—</strong></div>
        <fieldset class="vf-payment-choice">
          <legend>How would you like to pay?</legend>
          <label><input type="radio" name="vf-payment-method" value="wallet"> <span>Pay from my VerifyFlow wallet <small id="vf-wallet-balance" class="vf-wallet-balance">Checking wallet balance…</small></span></label>
          <label><input type="radio" name="vf-payment-method" value="monnify" checked> <span>Pay with Monnify <small>Secure payment using the methods enabled on your Monnify account</small></span></label>
          <a href="/account.html?panel=wallet" class="account-text-link">Fund your wallet ↗</a>
        </fieldset>
        <p class="vf-checkout-note">The final price is confirmed using a fresh supplier quote before payment.</p>
        <label id="vf-duration-wrap" class="catalog-duration" hidden>Rental period<select id="vf-duration-select"></select></label>
        <p class="vf-checkout-note">Catalogue prices are shown in USD. Monnify collects USD only when international collection is enabled on the account; otherwise checkout is converted to NGN using VerifyFlow’s configured rate and the payment methods enabled on the account. Taxes are not included.</p>
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
      walletBalanceLabel.textContent = "Wallet balance could not be loaded. Monnify is still available.";
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
    if (category === "sms") return { type: "sms_otp", id: item.id, country: item.countryCode || catalogue?.country || "us", provider: item.provider || "voidmob", available: item.available === true, price: item.priceCents };
    if (category === "rentals") { const durations = (item.durations || []).filter(x => Number.isSafeInteger(Number(x.priceCents)) && Number(x.priceCents) > 0).map(x => ({ days: Number(x.days), price: Number(x.priceCents) })); return { type: "long_term_number", id: item.id, country: item.countryCode || catalogue?.country || "us", provider: item.provider || "voidmob", available: item.available === true, price: Math.min(...durations.map(x => x.price)), durations }; }
    if (category === "esim") return { type: "esim", id: item.id, available: true, price: item.priceCents };
    if (category === "proxies") return { type: "mobile_proxy", id: item.id, available: item.available !== false, price: item.priceCents };
    if (category === "dedicated") return { type: "dedicated_number", id: item.country, country: item.country, available: item.inStock === true, price: item.priceCents };
    if (category === "marketing") return { type: "smm_service", id: item.id, provider: "", available: true, price: item.pricePer1000Minor, min: item.min, max: item.max };
    return null;
  }

  function renderButtons() {
    if (!catalogue) return;
    const cards = [...grid.querySelectorAll(".catalog-item")];
    cards.forEach(card => {
      if (card.querySelector(".vf-buy-area")) return;
      const category = card.dataset.productCategory || "sms";
      const key = card.dataset.productKey || "";
      const item = visibleRows(category).find(row => String(row.id??row.productId??row.country??row.title??row.name??row.full_title??"") === key);
      if (!item) return;
      const product = productDetails(category, item);
      if (!product) {
        return;
      }
      if (!product.id || !Number.isSafeInteger(Number(product.price)) || Number(product.price) <= 0) return;
      const durations = product.durations || [];
      if (category === "marketing") {
        const min = Number(product.min), max = Number(product.max);
        const area = document.createElement("div");
        area.className = "vf-buy-area vf-smm-buy-area";
        area.innerHTML = '<label>Target profile or post URL<input type="url" data-smm-link required placeholder="https://www.tiktok.com/@name/video/..."></label>' +
          '<label>Quantity (min ' + esc(min) + ' · max ' + esc(max) + ')<input type="number" data-smm-quantity min="' + esc(min) + '" max="' + esc(max) + '" step="1" value="' + esc(min) + '" required></label>' +
          '<small data-smm-total>Estimated price: ' + esc(money(Math.ceil(Number(product.price) * min / 1000))) + '</small>' +
          '<button class="vf-buy-button" type="button" data-vf-buy="true" data-product-type="smm_service" data-product-id="' + esc(product.id) + '" data-product-name="' + esc(item.name || "Social media service") + '" data-product-price="' + esc(product.price) + '" data-min="' + esc(min) + '" data-max="' + esc(max) + '">Continue to checkout →</button>';
        card.querySelector(".catalog-item-copy")?.appendChild(area);
        const quantityInput = area.querySelector("[data-smm-quantity]");
        quantityInput.addEventListener("input", () => {
          const quantity = Number(quantityInput.value);
          const valid = Number.isSafeInteger(quantity) && quantity >= min && quantity <= max;
          area.querySelector("[data-smm-total]").textContent = valid
            ? "Estimated price: " + money(Math.ceil(Number(product.price) * quantity / 1000))
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
        'data-product-price="' + esc(product.price) + '" data-duration-prices="' + esc(JSON.stringify(durations)) + '"' + (product.available && durations.length !== 0 || product.available && category !== "rentals" ? "" : " disabled") +
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

  grid.addEventListener("click", async event => {
    const button = event.target.closest("[data-vf-buy]");
    if (!button || button.disabled) return;
    await sessionReady;
    if (!signedIn) { window.location.href = "/account.html"; return; }
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
      durationDays: Number(card?.querySelector("[data-rental-days]")?.value || 0)
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
    dialog.showModal();
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
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!selected) return;
    submit.disabled = true;
    submit.textContent = "Preparing secure checkout…";
    message.textContent = "";
    const paymentMethod = form.querySelector('input[name="vf-payment-method"]:checked')?.value || "monnify";
    if (paymentMethod === "wallet" && walletBalanceMinor != null && walletBalanceMinor < selected.estimate) {
      message.textContent = "Your wallet balance is too low. Fund your wallet or choose Monnify.";
      submit.disabled = false;
      submit.textContent = "Continue to payment ↗";
      return;
    }
    const payload = {
      checkoutKey: selected.checkoutKey,
      productType: selected.productType,
      productId: selected.productId,
      paymentMethod
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
