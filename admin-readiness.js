"use strict";
(() => {
  const summary = document.getElementById("readiness-summary");
  const checksRoot = document.getElementById("readiness-checks");
  if (!summary || !checksRoot) return;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const labels = {
    ready: "Configured",
    needs_action: "Action required",
    review: "Manual verification",
    optional: "Optional"
  };

  async function loadReadiness() {
    summary.textContent = "Checking configuration and database migrations…";
    checksRoot.innerHTML = '<div class="empty">Loading launch checks…</div>';
    try {
      const response = await fetch("/api/admin/readiness", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Readiness report unavailable.");

      const count = Number(data.needsAction || 0);
      const reviews = Number(data.reviews || 0);
      summary.textContent = data.requiredChecksReady
        ? "All required environment checks are configured. " + reviews + " item(s) still need manual verification."
        : count + " required item(s) need action and " + reviews + " item(s) need manual verification.";
      summary.classList.toggle("readiness-good", data.requiredChecksReady);
      summary.classList.toggle("readiness-warn", !data.requiredChecksReady);

      checksRoot.innerHTML = (data.checks || []).map(check => {
        const status = labels[check.status] || "Check";
        return '<article class="admin-card readiness-card readiness-' + esc(check.status) + '">' +
          '<div class="readiness-card-head"><strong>' + esc(check.label) + '</strong>' +
          '<span class="readiness-pill">' + esc(status) + '</span></div>' +
          '<small>' + esc(check.message) + '</small>' +
          '<small class="readiness-action">' + esc(check.action) + '</small>' +
          (check.required ? "" : '<small class="readiness-optional">Not required for the existing connectivity checkout.</small>') +
          '</article>';
      }).join("") || '<div class="empty">No checks are available.</div>';
    } catch (error) {
      summary.textContent = error.message || "Readiness report unavailable.";
      summary.classList.remove("readiness-good");
      summary.classList.add("readiness-warn");
      checksRoot.innerHTML = '<div class="empty">Sign in with the authorized VerifyFlow admin account, then refresh.</div>';
    }
  }

  document.getElementById("refresh")?.addEventListener("click", loadReadiness);
  loadReadiness();
})();
