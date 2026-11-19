"use strict";
(() => {
  const host = document.getElementById("supplier-connections");
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
      const hero = data.heroSms || { connected: false, message: "HeroSMS Account API status unavailable." };
      const heroCard = '<article class="admin-card"><strong>HeroSMS</strong><div class="big">' + esc(hero.connected ? "Account API connected" : "Account API not connected") + '</div>' +
        '<small>USD balance: <b>' + esc(hero.usd == null ? "—" : Number(hero.usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD") + '</b></small>' +
        '<small>RUB balance: <b>' + esc(hero.rub == null ? "—" : Number(hero.rub).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " RUB") + '</b></small>' +
        '<small>' + esc(hero.message || "Read-only account check.") + '</small></article>';
      host.innerHTML = voidMobCard + heroCard + data.providers.map(provider => {
        const status = provider.connected ? "Connected" : "Not connected";
        const services = Number(provider.eligibleCount || 0);
        return '<article class="admin-card"><strong>' + esc(provider.label) + '</strong>' +
          '<div class="big">' + esc(status) + '</div>' +
          '<small>Supplier wallet: <b>' + esc(walletLabel(provider)) + '</b></small>' +
          '<small>Catalogue entries checked: ' + esc(provider.totalServices ?? "—") + '</small>' +
          '<small>Eligible marketing services: <b>' + esc(services) + '</b></small>' +
          (provider.message ? '<small>' + esc(provider.message) + '</small>' : '') +
          (services ? '<small>Available eligible services: ' + provider.eligibleServices.slice(0, 8).map(item => esc(item.name) + ' · supplier rate: ' + esc(item.supplierRateReported || "not reported")).join("; ") + '</small><small>Rate unit and service currency are unconfirmed; raw rates are not retail prices.</small>' : '') +
          '</article>';
      }).join("");
      host.insertAdjacentHTML("beforeend", '<p class="admin-foot">HeroSMS is currently checked through its read-only Account API; it is not an OTP catalogue connection. Supplier rates are displayed exactly as reported. Rate units and service currency have not been confirmed, so no retail price or margin is calculated. This report is read-only; no supplier orders are placed from this screen.</p>');
    } catch (error) {
      host.innerHTML = '<div class="empty">' + esc(error.message || "Supplier report unavailable.") + '</div>';
    }
  }
  document.getElementById("refresh")?.addEventListener("click", load);
  load();
})();
