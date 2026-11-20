"use strict";
(() => {
  const panel = document.getElementById("panel-wallet");
  if (!panel) return;

  const balance = document.getElementById("wallet-balance");
  const message = document.getElementById("wallet-message");
  const transactions = document.getElementById("wallet-transactions");
  const count = document.getElementById("wallet-transaction-count");
  const form = document.getElementById("wallet-fund-form");
  const amount = document.getElementById("wallet-fund-amount");
  const submit = document.getElementById("wallet-fund-submit");
  const fundMessage = document.getElementById("wallet-fund-message");

  const money = minor => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD"
  }).format(Number(minor || 0) / 100);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const dateLabel = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" :
      date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  async function load() {
    if (!panel || panel.hidden) return;
    message.textContent = "Refreshing your wallet balance…";
    try {
      const response = await fetch("/api/wallet", {
        credentials: "same-origin", cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.assign("/account.html");
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.error || "Your wallet could not be loaded.");
      balance.textContent = money(data.wallet?.balanceMinor);
      message.textContent = "Available to spend on VerifyFlow products.";
      const rows = Array.isArray(data.wallet?.transactions) ? data.wallet.transactions : [];
      count.textContent = rows.length + " transaction" + (rows.length === 1 ? "" : "s");
      if (!rows.length) {
        transactions.innerHTML = '<div class="activity-empty">No wallet activity yet. Fund your wallet to get started.</div>';
      } else {
        transactions.innerHTML = rows.map(row => {
          const credit = Number(row.amountMinor) > 0;
          const amountLabel = (credit ? "+" : "−") + money(Math.abs(Number(row.amountMinor)));
          return '<article class="wallet-transaction"><div class="wallet-transaction-copy"><strong>' +
            esc(row.description || "Wallet transaction") + '</strong><small>' +
            esc(dateLabel(row.createdAt)) + ' · ' + esc(String(row.type || "transaction").replaceAll("_", " ")) +
            '</small></div><strong class="wallet-transaction-amount ' + (credit ? "credit" : "debit") + '">' +
            esc(amountLabel) + '</strong></article>';
        }).join("");
      }
    } catch (error) {
      message.textContent = error.message || "Your wallet is temporarily unavailable.";
    }
  }

  form?.addEventListener("submit", async event => {
    event.preventDefault();
    fundMessage.textContent = "";
    if (!form.reportValidity()) return;
    const usd = Number(amount.value);
    if (!Number.isFinite(usd) || usd < 5 || usd > 1000) {
      fundMessage.textContent = "Enter an amount between $5 and $1,000.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Preparing Monnify checkout…";
    try {
      const response = await fetch("/api/wallet/deposit", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ amountUsdCents: Math.round(usd * 100) })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.assign("/account.html");
        return;
      }
      if (!response.ok || !data.ok || typeof data.checkoutUrl !== "string") {
        throw new Error(data.error || "Wallet funding could not be started.");
      }
      fundMessage.textContent = "Monnify checkout is ready. Your balance will update after the payment is verified.";
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      fundMessage.textContent = error.message || "Please try again.";
      submit.disabled = false;
      submit.textContent = "Fund wallet with Monnify ↗";
    }
  });

  document.getElementById("wallet-refresh")?.addEventListener("click", load);
  window.VerifyFlowWallet = { load };
})();
