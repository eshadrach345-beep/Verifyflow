"use strict";
(() => {
  const host = document.getElementById("supplier-connections-content");
  if (!host) return;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const walletLabel = provider => {
    if (provider.balance == null) return "—";
    const amount = Number(provider.balance);
    if (!Number.isFinite(amount)) return "—";
    return amount.toLocaleString("en-US", { maximumFractionDigits: 6 }) +
      (provider.currency ? " " + provider.currency : " (currency not returned)");
  };
  function minimumDepositControl(provider, amountMinor) {
    const amount = amountMinor == null ? "" : (Number(amountMinor) / 100).toFixed(2);
    return '<div class="supplier-minimum-setting"><label>Minimum deposit (USD)<input type="number" min="0" max="1000000" step="0.01" data-minimum-deposit="' + esc(provider) + '" value="' + esc(amount) + '" placeholder="Enter supplier minimum"></label><button class="admin-btn" type="button" data-save-minimum="' + esc(provider) + '">Save minimum</button><small>Enter the supplier’s minimum for one deposit. Use 0 if there is no minimum.</small></div>';
  }
  async function load() {
    host.innerHTML = '<div class="empty">Checking supplier connections…</div>';
    try {
      const response = await fetch("/api/admin/suppliers", {
        credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Supplier report unavailable.");
      const voidMob = data.voidMob || { connected: false, message: "VoidMob account status unavailable." };
      const voidMobCard = '<article class="admin-card"><strong>VoidMob</strong><div class="big">' + esc(voidMob.connected ? "API connected" : "API not connected") + '</div>' +
        '<small>Wallet balance: <b>' + esc(voidMob.balanceFormatted || "—") + '</b></small>' +
        '<small>' + esc(voidMob.message || "Read-only account check.") + '</small>' + minimumDepositControl("voidmob", data.minimumDeposits?.voidmob) + '</article>';
      const hero = data.heroSms || { connected: false, accountKeyConfigured: false, retailApiConfigured: false, message: "HeroSMS account balance status unavailable." };
      const retail = data.heroSmsRetail || { configured: false, connected: false, countryCount: 0, message: "HeroSMS retail catalogue status unavailable." };
      const retailStatus = retail.connected ? "Retail catalogue API connected" : retail.configured ? "Retail catalogue API not responding" : "Retail catalogue key not configured";
      const accountStatus = hero.connected ? "Account balance connected" : hero.accountKeyConfigured ? "Account balance key rejected / unavailable" : "Account balance key not configured";
      const heroCard = '<article class="admin-card"><strong>HeroSMS</strong><div class="big">' + esc(retailStatus) + '</div>' +
        '<small>Retail catalogue check: <b>' + esc(retail.countryCount || 0) + ' countries' + '</b></small>' +
        '<small>Account balance API: <b>' + esc(accountStatus) + '</b></small>' +
        '<small>Account balance: <b>' + esc(hero.balance == null ? "—" : Number(hero.balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (hero.currency || "USD")) + '</b></small>' +
        '<small>' + esc(retail.message || "Retail catalogue and account balance are checked independently.") + '</small>' +
        (hero.message ? '<small>' + esc(hero.message) + '</small>' : '') + minimumDepositControl("herosms", data.minimumDeposits?.herosms) + '</article>';
      host.innerHTML = voidMobCard + heroCard + data.providers.map(provider => {
        const status = provider.connected ? "Connected" : "Not connected";
        const services = Number(provider.eligibleCount || 0);
        return '<article class="admin-card"><strong>' + esc(provider.label) + '</strong>' +
          '<div class="big">' + esc(status) + '</div>' +
          '<small>Supplier wallet: <b>' + esc(walletLabel(provider)) + '</b></small>' +
          '<small>Catalogue entries checked: ' + esc(provider.totalServices ?? "—") + '</small>' +
          '<small>SMM services in supplier catalogue: <b>' + esc(services) + '</b></small>' +
          (provider.message ? '<small>' + esc(provider.message) + '</small>' : '') + minimumDepositControl(provider.provider, data.minimumDeposits?.[provider.provider]) +
          (services ? '<small>Sample available services: ' + provider.eligibleServices.slice(0, 8).map(item => esc(item.name) + ' · supplier rate: ' + esc(item.supplierRateReported || "not reported")).join("; ") + '</small><small>Set your own retail price per 1,000 in the Social Media Boosters product manager.</small>' : '') +
          '</article>';
      }).join("");
      host.insertAdjacentHTML("beforeend", '<p class="admin-foot">Set each supplier’s actual minimum deposit from its own dashboard. Funding suggestions use the supplier’s reported wallet balance and all pending supplier costs. If a balance cannot be verified, check it directly with the supplier before depositing. Saving a minimum deposit does not transfer money or place an order.</p>');
      host.addEventListener("click", async event => {
        const button = event.target.closest("[data-save-minimum]");
        if (!button) return;
        const provider = button.dataset.saveMinimum;
        const field = host.querySelector('[data-minimum-deposit="' + provider + '"]');
        const value = Number(field?.value || 0);
        if (!Number.isFinite(value) || value < 0) return;
        button.disabled = true; button.textContent = "Saving…";
        try {
          const response = await fetch("/api/admin/suppliers", {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ provider, minimumDeposit: value })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.ok) throw new Error(result.error || "Could not save supplier minimum.");
          await load();
        } catch (error) {
          button.disabled = false; button.textContent = "Save minimum";
          const note = button.parentElement.querySelector("small");
          if (note) note.textContent = error.message || "Could not save supplier minimum.";
        }
      }, { once: true });
    } catch (error) {
      host.innerHTML = '<div class="empty">' + esc(error.message || "Supplier report unavailable.") + '</div>';
    }
  }
  document.getElementById("refresh")?.addEventListener("click", load);
  load();
})();
