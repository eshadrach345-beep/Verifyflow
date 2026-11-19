"use strict";
(() => {
  const body = document.getElementById("fulfilment-queue");
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
  async function loadQueue() {
    body.innerHTML = '<tr><td colspan="7" class="empty">Loading fulfilment queue…</td></tr>';
    try {
      const response = await fetch("/api/admin/fulfilment", {
        credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Queue unavailable.");
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      if (!jobs.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">No supplier jobs have been created yet.</td></tr>';
        return;
      }
      body.innerHTML = jobs.map(job => {
        const action = ["paid", "processing"].includes(job.order_status) && job.fulfilment_status === "pending" ? "submit" :
          ["paid", "processing"].includes(job.order_status) && job.fulfilment_status === "unknown" ? "retry_unknown" : null;
        const actionLabel = action === "retry_unknown" ? "Reconcile safely" : "Submit";
        return '<tr><td><b>' + esc(job.order_number) + '</b></td>' +
          '<td>' + esc(job.product_name) + '<br><span class="muted">' + esc(job.product_type) + ' · ' + esc(job.supplier || "supplier") + '</span></td>' +
          '<td><span class="status ' + esc(job.fulfilment_status) + '">' + esc(job.fulfilment_status) + '</span></td>' +
          '<td>' + esc(job.supplier_status || "—") + '</td>' +
          '<td>' + (job.supplier_cost_minor == null ? "—" : esc(money(job.supplier_cost_minor, job.supplier_currency))) + '</td>' +
          '<td>' + esc(job.last_error_message || job.last_error_code || "—") + '</td>' +
          '<td>' + (action ? '<button class="admin-btn" type="button" data-submit-order="' + esc(job.order_id) + '" data-submit-action="' + esc(action) + '">' + esc(actionLabel) + '</button>' : "—") + '</td></tr>';
      }).join("");
    } catch (error) {
      body.innerHTML = '<tr><td colspan="7" class="empty">' + esc(error.message || "Queue unavailable.") + '</td></tr>';
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
