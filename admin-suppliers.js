"use strict";
(() => {
  const host = document.getElementById("supplier-connections");
  if (!host) return;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const money = (value, currency) => {
    if (!Number.isFinite(Number(value))) return "—";
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(Number(value)); }
    catch { return (currency || "USD") + " " + Number(value).toFixed(2); }
  };
  async function load() {
    host.innerHTML = '<div class="empty">Checking supplier connections…</div>';
    try {
      const response = await fetch("/api/admin/suppliers", {
        credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Supplier report unavailable.");
      host.innerHTML = data.providers.map(provider => {
        const status = provider.connected ? "Connected" : "Not connected";
        const services = Number(provider.eligibleCount || 0);
        return '<article class="admin-card"><strong>' + esc(provider.label) + '</strong>' +
          '<div class="big">' + esc(status) + '</div>' +
          '<small>Supplier wallet: <b>' + esc(money(provider.balance, provider.currency)) + '</b></small>' +
          '<small>Catalogue entries checked: ' + esc(provider.totalServices ?? "—") + '</small>' +
          '<small>Eligible marketing services: <b>' + esc(services) + '</b></small>' +
          (provider.message ? '<small>' + esc(provider.message) + '</small>' : '') +
          (services ? '<small>Available eligible services: ' + provider.eligibleServices.map(item => esc(item.name) + ' · ' + esc(money(item.retailRatePerThousandCents / 100, "USD")) + '/1K').join("; ") + '</small>' : '') +
          '</article>';
      }).join("");
      const p = data.pricing || {};
      host.insertAdjacentHTML("beforeend", '<p class="admin-foot">Retail pricing rule: ' +
        esc(p.markupPercent) + '% markup, minimum ' + esc(money(Number(p.minimumMarkupCents) / 100, "USD")) +
        ' per 1,000 units. This report is read-only; no supplier orders are placed from this screen.</p>');
    } catch (error) {
      host.innerHTML = '<div class="empty">' + esc(error.message || "Supplier report unavailable.") + '</div>';
    }
  }
  document.getElementById("refresh")?.addEventListener("click", load);
  load();
})();
