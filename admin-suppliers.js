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
        '<small>' + esc(voidMob.message || "Read-only account check.") + '</small></article>';
      const hero = data.heroSms || { connected: false, message: "HeroSMS retail API status unavailable." };
      const heroCard = '<article class="admin-card"><strong>HeroSMS</strong><div class="big">' + esc(hero.connected ? "Account API connected" : "Account API not connected") + '</div>' +
        '<small>Wallet balance: <b>' + esc(hero.balance == null ? "—" : Number(hero.balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (hero.currency || "USD")) + '</b></small>' +
        '<small>Retail inventory key: <b>' + esc(hero.retailApiConfigured ? "Configured" : "Not configured") + '</b></small>' +
        '<small>' + esc(hero.message || "Read-only Account API check.") + '</small></article>';
      host.innerHTML = voidMobCard + heroCard + data.providers.map(provider => {
        const status = provider.connected ? "Connected" : "Not connected";
        const services = Number(provider.eligibleCount || 0);
        return '<article class="admin-card"><strong>' + esc(provider.label) + '</strong>' +
          '<div class="big">' + esc(status) + '</div>' +
          '<small>Supplier wallet: <b>' + esc(walletLabel(provider)) + '</b></small>' +
          '<small>Catalogue entries checked: ' + esc(provider.totalServices ?? "—") + '</small>' +
          '<small>SMM services in supplier catalogue: <b>' + esc(services) + '</b></small>' +
          (provider.message ? '<small>' + esc(provider.message) + '</small>' : '') +
          (services ? '<small>Sample available services: ' + provider.eligibleServices.slice(0, 8).map(item => esc(item.name) + ' · supplier rate: ' + esc(item.supplierRateReported || "not reported")).join("; ") + '</small><small>Set your own retail price per 1,000 in the Social Media Boosters product manager.</small>' : '') +
          '</article>';
      }).join("");
      host.insertAdjacentHTML("beforeend", '<p class="admin-foot">HeroSMS is checked through its retail API. Its live country, service, price and stock catalogue is combined with other suppliers on the customer marketplace. Purchases through HeroSMS remain disabled until its order, OTP polling, cancellation and refund flow has passed end-to-end tests. This report is read-only; no supplier orders are placed from this screen.</p>');
    } catch (error) {
      host.innerHTML = '<div class="empty">' + esc(error.message || "Supplier report unavailable.") + '</div>';
    }
  }
  document.getElementById("refresh")?.addEventListener("click", load);
  load();
})();
