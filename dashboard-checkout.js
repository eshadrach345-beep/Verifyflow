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
    .vf-buy-area select{width:100%;border:1px solid #c8d0d2;border-radius:7px;padding:9px;background:#fff;color:#111;font:500 13px Inter,Arial}
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
        <p class="vf-checkout-note">The final price is confirmed using a fresh supplier quote before payment.</p>
        <label id="vf-duration-wrap" class="catalog-duration" hidden>Rental period<select id="vf-duration-select"></select></label>
        <p class="vf-checkout-note">Payment is in USD through Monnify card checkout. International USD payments require account activation and currently support Mastercard. Taxes are not included.</p>
        <p id="vf-checkout-message" class="vf-checkout-message" role="status" aria-live="polite"></p>
        <button id="vf-checkout-submit" class="vf-buy-button" type="submit">Continue to secure payment ↗</button>
      </form>
    </dialog>
  `);
  const dialog = document.getElementById("vf-checkout-dialog");
  const form = document.getElementById("vf-checkout-form");
  const message = document.getElementById("vf-checkout-message");
  const submit = document.getElementById("vf-checkout-submit");

  function key() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID().replaceAll("-", "");
    return "vf" + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function activeCategory() {
    return document.querySelector("[data-catalog-tab].is-active")?.dataset.catalogTab || "sms";
  }
  function visibleRows() {
    const section = catalogue?.sections?.[activeCategory()];
    const rows = Array.isArray(section?.items) ? section.items : [];
    const query = String(searchInput?.value || "").trim().toLowerCase();
    return query ? rows.filter(item => JSON.stringify(item).toLowerCase().includes(query)) : rows;
  }

  function productDetails(category, item) {
    if (category === "sms") return { type: "sms_otp", id: item.id, country: "us", available: item.available === true, price: item.priceCents };
    if (category === "rentals") { const durations = (item.durations || []).filter(x => Number.isSafeInteger(Number(x.priceCents)) && Number(x.priceCents) > 0).map(x => ({ days: Number(x.days), price: Number(x.priceCents) })); return { type: "long_term_number", id: item.id, country: "us", available: item.available === true, price: Math.min(...durations.map(x => x.price)), durations }; }
    if (category === "esim") return { type: "esim", id: item.id, available: true, price: item.priceCents };
    if (category === "proxies") return { type: "mobile_proxy", id: item.id, available: item.available !== false, price: item.priceCents };
    if (category === "dedicated") return { type: "dedicated_number", id: item.country, country: item.country, available: item.inStock === true, price: item.priceCents };
    return null;
  }

  function renderButtons() {
    if (!catalogue) return;
    const category = activeCategory();
    const rows = visibleRows();
    const cards = [...grid.querySelectorAll(".catalog-item")];
    cards.forEach((card, index) => {
      if (card.querySelector(".vf-buy-area")) return;
      const item = rows[index];
      if (!item) return;
      const product = productDetails(category, item);
      if (!product || !product.id || !Number.isSafeInteger(Number(product.price)) || Number(product.price) <= 0) return;
      const durations = product.durations || [];
      const select = category === "rentals" && durations.length
        ? '<select aria-label="Choose rental period" data-rental-days>' + durations.map(option => '<option value="' + esc(option.days) + '">' + esc(option.days) + ' days</option>').join("") + '</select>'
        : "";
      const button = '<button class="vf-buy-button" type="button" data-vf-buy="true" ' +
        'data-product-type="' + esc(product.type) + '" data-product-id="' + esc(product.id) + '" ' +
        'data-country="' + esc(product.country || "") + '" data-product-name="' + esc(item.title || item.name || item.full_title || item.country || "VerifyFlow service") + '" ' +
        'data-product-price="' + esc(product.price) + '" data-duration-prices="' + esc(JSON.stringify(durations)) + '"' + (product.available && durations.length !== 0 || product.available && category !== "rentals" ? "" : " disabled") +
        '>Continue to checkout →</button>';
      card.querySelector(".catalog-item-copy")?.insertAdjacentHTML("beforeend", '<div class="vf-buy-area">' + select + button + '</div>');
    });
  }

  async function loadCatalogue() {
    const country = "us";
    if (countryInput) { countryInput.value = "US"; countryInput.disabled = true; }
    try {
      const response = await fetch("/api/catalog?country=" + country, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || !data.sections) throw new Error("Catalogue unavailable");
      catalogue = data;
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
    const card = button.closest(".catalog-item");
    selected = {
      productType: button.dataset.productType,
      productId: button.dataset.productId,
      country: button.dataset.country || "us",
      productName: button.dataset.productName || "VerifyFlow service",
      estimate: Number(button.dataset.productPrice),
      durationPrices: JSON.parse(button.dataset.durationPrices || "[]"),
      checkoutKey: key(),
      durationDays: Number(card?.querySelector("[data-rental-days]")?.value || 0)
    };
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
    const payload = {
      checkoutKey: selected.checkoutKey,
      productType: selected.productType,
      productId: selected.productId,
      country: selected.country
    };
    if (selected.productType === "long_term_number") payload.durationDays = Number(document.getElementById("vf-duration-select").value);
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
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      message.textContent = error.message || "Please try again.";
      submit.disabled = false;
      submit.textContent = "Try secure checkout again ↗";
    }
  });

  const observer = new MutationObserver(() => renderButtons());
  observer.observe(grid, { childList: true });
  document.querySelectorAll("[data-catalog-tab]").forEach(tab => tab.addEventListener("click", () => {
    window.setTimeout(renderButtons, 0);
  }));
  searchInput?.addEventListener("input", () => window.setTimeout(renderButtons, 0));
  document.getElementById("catalog-refresh")?.addEventListener("click", () => window.setTimeout(loadCatalogue, 300));
  loadCatalogue();
})();
