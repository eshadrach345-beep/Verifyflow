"use strict";
(() => {
  const body = document.getElementById("fulfilment-queue-body");
  if (!body) return;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const money = (minor, currency) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" })
        .format(Number(minor || 0) / 100);
    } catch {
      return (currency || "USD") + " " + (Number(minor || 0) / 100).toFixed(2);
    }
  };
  const supplierBalanceMinor = snapshot => {
    if (!snapshot) return null;
    if (snapshot.balanceCents != null && Number.isSafeInteger(Number(snapshot.balanceCents))) return Number(snapshot.balanceCents);
    if (snapshot.balance == null || !Number.isFinite(Number(snapshot.balance))) return null;
    return Math.round(Number(snapshot.balance) * 100);
  };
  async function loadQueue() {
    body.innerHTML = '<tr><td colspan="8" class="empty">Loading fulfilment queue…</td></tr>';
    try {
      const response = await fetch("/api/admin/fulfilment", {
        credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Queue unavailable.");
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      let supplierSnapshot = null;
      try {
        const supplierResponse = await fetch("/api/admin/suppliers", {
          credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }
        });
        const supplierData = await supplierResponse.json().catch(() => ({}));
        if (supplierResponse.ok && supplierData.ok) supplierSnapshot = supplierData;
      } catch {}
      const balances = {};
      if (supplierSnapshot) {
        balances.voidmob = supplierBalanceMinor(supplierSnapshot.voidMob);
        balances.herosms = supplierSnapshot.heroSms?.balance == null ? null : Math.round(Number(supplierSnapshot.heroSms.balance) * 100);
        for (const provider of supplierSnapshot.providers || []) balances[provider.provider] = provider.balance == null ? null : Math.round(Number(provider.balance) * 100);
      }
      const pendingCosts = {};
      for (const job of jobs) {
        if (job.fulfilment_status !== "pending" || job.supplier_cost_minor == null) continue;
        const currency = String(job.supplier_currency || "USD").toUpperCase();
        if (currency !== "USD") continue;
        pendingCosts[job.supplier] = (pendingCosts[job.supplier] || 0) + Number(job.supplier_cost_minor);
      }
      const fundingGuidance = supplier => {
        if (!supplierSnapshot) return "Supplier balance unavailable";
        const balance = balances[supplier];
        if (balance == null) return "Balance unavailable — check supplier dashboard";
        const shortfall = Math.max(0, (pendingCosts[supplier] || 0) - balance);
        if (!shortfall) return "No top-up indicated by current balance";
        const minimum = supplierSnapshot.minimumDeposits?.[supplier];
        if (minimum == null) return "Set minimum deposit in Supplier Catalogues";
        const deposit = Math.max(shortfall, Number(minimum));
        return "Deposit at least " + money(deposit, "USD") + " (shortfall " + money(shortfall, "USD") + ")";
      };
      if (!jobs.length) {
        body.innerHTML = '<tr><td colspan="8" class="empty">No supplier jobs have been created yet.</td></tr>';
        return;
      }
      body.innerHTML = jobs.map(job => {
        const action = ["paid", "processing"].includes(job.order_status) && job.fulfilment_status === "pending" ? "submit" :
          ["paid", "processing"].includes(job.order_status) && job.fulfilment_status === "unknown" && job.supplier === "voidmob" ? "retry_unknown" : null;
        const fundingIssue = /insufficient|balance|funds|deposit/i.test(String(job.last_error_code || "") + " " + String(job.last_error_message || ""));
        const actionLabel = action === "retry_unknown" ? "Reconcile safely" : fundingIssue ? "Retry after funding" : "Submit";
        return '<tr><td><b>' + esc(job.order_number) + '</b></td>' +
          '<td>' + esc(job.product_name) + '<br><span class="muted">' + esc(job.product_type) + ' · ' + esc(job.supplier || "supplier") + '</span></td>' +
          '<td><span class="status ' + esc(job.fulfilment_status) + '">' + esc(job.fulfilment_status) + '</span></td>' +
          '<td>' + esc(job.supplier_status || "—") + '</td>' +
          '<td>' + (job.supplier_cost_minor == null ? "—" : esc(money(job.supplier_cost_minor, job.supplier_currency))) + '</td>' +
          '<td>' + esc(job.fulfilment_status === "pending" ? fundingGuidance(job.supplier) : "—") + '</td>' +
          '<td>' + esc(job.last_error_message || job.last_error_code || "—") + '</td>' +
          '<td>' + (action ? '<button class="admin-btn" type="button" data-submit-order="' + esc(job.order_id) + '" data-submit-action="' + esc(action) + '">' + esc(actionLabel) + '</button>' : "—") + '</td></tr>';
      }).join("");
    } catch (error) {
      body.innerHTML = '<tr><td colspan="8" class="empty">' + esc(error.message || "Queue unavailable.") + '</td></tr>';
    }
  }
  body.addEventListener("click", async event => {
    const button = event.target.closest("[data-submit-order]");
    if (!button) return;
    button.disabled = true;
    button.textContent = "Submitting…";
    try {
      const response = await fetch("/api/admin/fulfilment", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId: button.dataset.submitOrder, action: button.dataset.submitAction || "submit" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "The supplier request could not be submitted.");
      await loadQueue();
      document.getElementById("message").textContent = "Fulfilment queue updated. Current result: " + (data.result?.status || "processed") + ".";
      document.getElementById("refresh")?.click();
    } catch (error) {
      document.getElementById("message").textContent = error.message || "The supplier request could not be submitted.";
      button.disabled = false;
      button.textContent = "Submit";
    }
  });
  document.getElementById("refresh")?.addEventListener("click", loadQueue);
  loadQueue();
})();
