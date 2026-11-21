"use strict";

const { randomBytes, randomUUID } = require("node:crypto");
const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../../lib/auth");
const { getMonnifyConfig, initializeTransaction } = require("../../lib/monnify");
const { getSquadConfig, initiateSquadPayment } = require("../../lib/squad");
const { quoteProduct: quoteVoidmobProduct } = require("../../lib/voidmob");
const { quoteProduct: quoteHeroSmsProduct } = require("../../lib/herosms");
const { getCheckoutAmount } = require("../../lib/checkout-currency");
const { ensureWalletAccount, postWalletTransaction } = require("../../lib/wallet");
const { enqueuePaidOrder, processFulfilmentForOrder } = require("../../lib/fulfilment");
const { openCatalogProductToken } = require("../../lib/catalog-token");

function validCheckoutKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(value);
}

function checkoutUrlIsSafe(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)monnify\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}


async function createWalletOrder({ user, checkoutKey, productType, selectedProvider, quote, sandboxMode }) {
  const pool = getPool();
  const client = await pool.connect();
  let orderId = null;
  let orderNumber = null;
  let existingOrder = false;
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT o.id, o.order_number, o.status, o.metadata, p.status AS payment_status " +
      "FROM vf_orders o LEFT JOIN LATERAL (" +
      "SELECT status FROM vf_payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1" +
      ") p ON TRUE WHERE o.user_id = $1 AND o.checkout_key = $2 LIMIT 1 FOR UPDATE OF o",
      [user.id, checkoutKey]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.status === "paid" && row.metadata?.checkout?.paymentMethod === "wallet") {
        await client.query("COMMIT");
        return { ok: true, walletPaid: true, reused: true, orderNumber: row.order_number };
      }
      await client.query("ROLLBACK");
      const error = new Error("This checkout has already been started. Refresh your account orders.");
      error.code = "CHECKOUT_ALREADY_EXISTS";
      throw error;
    }

    await ensureWalletAccount(client, user.id);
    const wallet = await client.query(
      "SELECT balance_minor FROM vf_wallet_accounts WHERE user_id = $1 FOR UPDATE",
      [user.id]
    );
    const balanceMinor = Number(wallet.rows[0]?.balance_minor || 0);
    if (balanceMinor < quote.salePriceCents) {
      await client.query("ROLLBACK");
      const error = new Error("Your wallet balance is too low. Add funds or choose Squad at checkout.");
      error.code = "WALLET_INSUFFICIENT_FUNDS";
      error.status = 402;
      throw error;
    }

    orderId = randomUUID();
    orderNumber = "VF-" + randomBytes(6).toString("hex").toUpperCase();
    const walletReference = "VFWPAY_" + randomBytes(12).toString("hex").toUpperCase();
    const orderIdempotencyKey = "vf-order-" + orderId.replace(/-/g, "");
    const metadata = {
      platform: quote.productSnapshot?.platform || productType,
      ...(sandboxMode ? { sandboxTest: true, noFulfilment: true } : {}),
      checkout: {
        productSnapshot: quote.productSnapshot,
        supplierInput: quote.supplierInput,
        supplierPriceCents: quote.supplierPriceCents,
        retailPriceCents: quote.salePriceCents,
        retailCurrency: "USD",
        paymentAmountMinor: quote.salePriceCents,
        currency: "USD",
        paymentMethod: "wallet",
        walletPaid: true,
        checkoutCreatedAt: new Date().toISOString()
      }
    };
    await client.query(
      "INSERT INTO vf_orders (id, user_id, order_number, provider, product_type, product_name, status, currency, subtotal_minor, total_minor, idempotency_key, checkout_key, metadata) " +
      "VALUES ($1, $2, $3, $4, $5, $6, 'paid', 'USD', $7, $7, $8, $9, $10::jsonb)",
      [orderId, user.id, orderNumber, quote.provider || selectedProvider, productType, quote.productName,
        quote.salePriceCents, orderIdempotencyKey, checkoutKey, JSON.stringify(metadata)]
    );
    await client.query(
      "INSERT INTO vf_payments (order_id, payment_reference, currency, amount_minor, status) " +
      "VALUES ($1, $2, 'USD', $3, 'paid')",
      [orderId, walletReference, quote.salePriceCents]
    );
    await postWalletTransaction(client, {
      userId: user.id,
      amountMinor: -quote.salePriceCents,
      type: "purchase",
      referenceType: "wallet_order",
      referenceId: orderId,
      description: "Purchase: " + quote.productName,
      metadata: { orderId, orderNumber, paymentReference: walletReference }
    });
    await enqueuePaidOrder(client, orderId);
    await client.query(
      "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'wallet_payment_confirmed', 'Order paid from VerifyFlow wallet balance.', $2::jsonb)",
      [orderId, JSON.stringify({ walletAmountMinor: quote.salePriceCents, currency: "USD" })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (!sandboxMode) {
    try { await processFulfilmentForOrder(orderId); }
    catch (error) { console.error("[orders/create/wallet-fulfilment]", error.code || error.message); }
  }
  return { ok: true, walletPaid: true, orderNumber, orderId };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: "Request could not be verified." });

  let body;
  try { body = await readJson(req); }
  catch { return sendJson(res, 400, { ok: false, error: "Please submit a valid order." }); }

  const checkoutKey = String(body.checkoutKey || "");
  if (!validCheckoutKey(checkoutKey)) {
    return sendJson(res, 400, { ok: false, error: "Refresh the product and try checkout again." });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { ok: false, error: "Please sign in before placing an order." });

    // Use USD only after international collection is activated on the Monnify contract.
    // Otherwise collect locally in NGN at the merchant-configured USD/NGN checkout rate.
    const paymentMethod = String(body.paymentMethod || "squad").toLowerCase();
    if (!["wallet", "monnify", "squad"].includes(paymentMethod)) {
      return sendJson(res, 400, { ok: false, error: "Choose Wallet, Squad or Monnify as your payment method." });
    }
    const config = paymentMethod === "monnify" ? getMonnifyConfig()
      : paymentMethod === "squad" ? (() => { const c = getSquadConfig(); return { environment: c.environment.toUpperCase() }; })()
      : { environment: String(process.env.MONNIFY_ENVIRONMENT || "SANDBOX").toUpperCase() };
    const productType = String(body.productType || "");
    let selectedProvider = String(body.provider || "voidmob").toLowerCase();
    let quote;

    if (productType === "smm_service") {
      const productId = String(body.productId || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
        return sendJson(res, 400, { ok: false, error: "Choose a valid social media product from the catalogue." });
      }
      const productResult = await getPool().query(
        "SELECT id, provider, supplier_service_id, platform, product_name, description, min_quantity, max_quantity, retail_rate_minor_per_1000, supplier_rate, supplier_currency " +
        "FROM vf_smm_products WHERE id = $1 AND is_active = TRUE LIMIT 1",
        [productId]
      );
      if (!productResult.rowCount) return sendJson(res, 404, { ok: false, error: "That social media product is no longer available." });
      const product = productResult.rows[0];
      selectedProvider = String(product.provider);
      const quantity = Number(body.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < Number(product.min_quantity) || quantity > Number(product.max_quantity)) {
        return sendJson(res, 400, { ok: false, error: "Choose a quantity within the supplier's limits." });
      }
      let target;
      try {
        target = new URL(String(body.targetUrl || "").trim());
        if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) throw new Error("invalid");
      } catch {
        return sendJson(res, 400, { ok: false, error: "Enter a valid public profile or content URL." });
      }
      const salePriceCents = Math.ceil(Number(product.retail_rate_minor_per_1000) * quantity / 1000);
      const supplierRate = product.supplier_rate == null ? null : Number(product.supplier_rate);
      const supplierPriceCents = String(product.supplier_currency || "").trim().toUpperCase() === "USD" &&
        Number.isFinite(supplierRate) && supplierRate > 0
        ? Math.ceil(supplierRate * quantity / 1000 * 100)
        : null;
      const productName = String(product.platform) + " " + String(product.product_name);
      quote = {
        provider: selectedProvider, productName, salePriceCents, supplierPriceCents,
        supplierCurrency: product.supplier_currency || null,
        supplierInput: {
          serviceId: String(product.supplier_service_id),
          link: target.toString(),
          quantity
        },
        productSnapshot: {
          productId: String(product.id), platform: String(product.platform),
          productName: String(product.product_name), supplierServiceId: String(product.supplier_service_id),
          supplier: selectedProvider, quantity, targetUrl: target.toString(),
          retailRateMinorPer1000: Number(product.retail_rate_minor_per_1000),
          minQuantity: Number(product.min_quantity), maxQuantity: Number(product.max_quantity)
        }
      };
    } else {
      // The customer only submits an encrypted catalogue selection. Supplier
      // identity, raw inventory IDs and country routing are resolved server-side.
      const selection = openCatalogProductToken(String(body.productId || ""));
      if (selection.productType !== productType) {
        return sendJson(res, 400, { ok: false, error: "That product selection does not match the selected service. Refresh the catalogue." });
      }
      selectedProvider = selection.provider;
      const input = {
        productId: selection.productId,
        country: selection.country,
        countryId: selection.countryId,
        productName: selection.productName,
        durationDays: Number(body.durationDays),
        provider: selection.provider,
        verificationType: String(body.verificationType || "sms").toLowerCase()
      };
      quote = selection.provider === "herosms"
        ? await quoteHeroSmsProduct(productType, input)
        : await quoteVoidmobProduct(productType, input);
    }

    const fulfilmentSwitches = {
      voidmob: process.env.VOIDMOB_FULFILMENT_ENABLED === "true" && process.env.VOIDMOB_AUTOBUY_CONFIRMED === "true",
      herosms: process.env.HEROSMS_FULFILMENT_ENABLED === "true" && process.env.HEROSMS_AUTOBUY_CONFIRMED === "true",
      peakerr: process.env.PEAKERR_FULFILMENT_ENABLED === "true" && process.env.PEAKERR_AUTOBUY_CONFIRMED === "true",
      justanotherpanel: process.env.JUSTANOTHERPANEL_FULFILMENT_ENABLED === "true" && process.env.JUSTANOTHERPANEL_AUTOBUY_CONFIRMED === "true"
    };
    if (!Object.hasOwn(fulfilmentSwitches, selectedProvider)) {
      return sendJson(res, 400, { ok: false, error: "Choose a supported supplier." });
    }
    if (config.environment === "LIVE" &&
        (process.env.VERIFYFLOW_LIVE_ORDERS_ENABLED !== "true" || !fulfilmentSwitches[selectedProvider])) {
      return sendJson(res, 503, {
        ok: false,
        error: "Live customer orders are still locked until payments, supplier auto-buy and fulfilment launch checks are complete."
      });
    }

    if (!Number.isSafeInteger(quote.salePriceCents) || quote.salePriceCents <= 0 ||
        (productType !== "smm_service" && (!Number.isSafeInteger(quote.supplierPriceCents) || quote.supplierPriceCents <= 0))) {
      return sendJson(res, 503, { ok: false, error: "A current price could not be confirmed for this product." });
    }

    if (paymentMethod === "wallet") {
      try {
        const result = await createWalletOrder({
          user, checkoutKey, productType, selectedProvider, quote,
          sandboxMode: String(config.environment || "").toUpperCase() !== "LIVE"
        });
        return sendJson(res, 200, result);
      } catch (error) {
        if (error.code === "WALLET_INSUFFICIENT_FUNDS") return sendJson(res, 402, { ok: false, error: error.message });
        if (error.code === "CHECKOUT_ALREADY_EXISTS") return sendJson(res, 409, { ok: false, error: error.message });
        throw error;
      }
    }

    const checkoutAmount = getCheckoutAmount(quote.salePriceCents);
    const paymentCurrency = checkoutAmount.currency;
    const paymentAmountMinor = checkoutAmount.amountMinor;

    const pool = getPool();
    const existing = await pool.query(
      "SELECT o.id, o.order_number, o.status, p.payment_reference, p.checkout_url, p.status AS payment_status, p.amount_minor, p.currency " +
      "FROM vf_orders o LEFT JOIN LATERAL (SELECT payment_reference, checkout_url, status, amount_minor, currency FROM vf_payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) p ON TRUE " +
      "WHERE o.user_id = $1 AND o.checkout_key = $2 LIMIT 1",
      [user.id, checkoutKey]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.checkout_url && row.payment_status !== "paid") {
        return sendJson(res, 200, {
          ok: true, checkoutUrl: row.checkout_url, paymentReference: row.payment_reference,
          orderNumber: row.order_number, amountMinor: Number(row.amount_minor), currency: String(row.currency || paymentCurrency), reused: true
        });
      }
      return sendJson(res, 409, {
        ok: false,
        error: row.payment_status === "paid"
          ? "This checkout has already been paid. View your order in your account."
          : "This checkout is already being processed. Refresh your account orders."
      });
    }

    const orderId = randomUUID();
    const orderSuffix = randomBytes(6).toString("hex").toUpperCase();
    const orderNumber = "VF-" + orderSuffix;
    const paymentReference = "VF_" + randomBytes(12).toString("hex").toUpperCase();
    const orderIdempotencyKey = "vf-order-" + orderId.replace(/-/g, "");
    const redirectUrl = (process.env.PUBLIC_APP_URL || "https://verifyflow.us.ci").replace(/\/+$/, "") +
      "/payment-return.html?paymentReference=" + encodeURIComponent(paymentReference);

    // Sandbox orders exercise the payment flow but can never create a live supplier job.
    const sandboxMode = String(config.environment || "").toUpperCase() !== "LIVE";
    const metadata = {
      platform: quote.productSnapshot?.platform || productType,
      ...(sandboxMode ? { sandboxTest: true, noFulfilment: true } : {}),
      checkout: {
        productSnapshot: quote.productSnapshot,
        supplierInput: quote.supplierInput,
        supplierPriceCents: quote.supplierPriceCents,
        retailPriceCents: quote.salePriceCents,
        retailCurrency: "USD",
        paymentAmountMinor,
        currency: paymentCurrency,
        usdNgnRate: checkoutAmount.usdNgnRate,
        checkoutCreatedAt: new Date().toISOString()
      }
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO vf_orders (id, user_id, order_number, provider, product_type, product_name, status, currency, subtotal_minor, total_minor, idempotency_key, checkout_key, metadata) " +
        "VALUES ($1, $2, $3, $4, $5, $6, 'awaiting_payment', $7, $8, $8, $9, $10, $11::jsonb)",
        [orderId, user.id, orderNumber, quote.provider || selectedProvider, productType, quote.productName, paymentCurrency, paymentAmountMinor,
          orderIdempotencyKey, checkoutKey, JSON.stringify(metadata)]
      );
      await client.query(
        "INSERT INTO vf_payments (order_id, payment_reference, currency, amount_minor, status, provider) " +
        "VALUES ($1, $2, $3, $4, 'initiated', $5)",
        [orderId, paymentReference, paymentCurrency, paymentAmountMinor, paymentMethod]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error.code === "23505") {
        return sendJson(res, 409, { ok: false, error: "This checkout has already been started. Refresh your account orders." });
      }
      throw error;
    } finally {
      client.release();
    }

    try {
      let checkoutUrl = "";
      let providerResponse = {};
      let transactionReference = null;
      if (paymentMethod === "squad") {
        const initialized = await initiateSquadPayment({
          email: user.email, customerName: user.full_name,
          amountMinor: paymentAmountMinor, currency: paymentCurrency,
          reference: paymentReference,
          callbackUrl: (process.env.PUBLIC_APP_URL || "https://verifyflow.us.ci").replace(/\/+$/, "") +
            "/payment-return.html?paymentReference=" + encodeURIComponent(paymentReference),
          metadata: { type: "product_order", orderId, orderNumber, userId: user.id }
        });
        checkoutUrl = initialized.checkoutUrl;
        providerResponse = initialized.raw;
      } else {
        const initialized = await initializeTransaction({
          amount: paymentAmountMinor / 100,
          customerName: user.full_name,
          customerEmail: user.email,
          paymentReference,
          paymentDescription: ("VerifyFlow " + quote.productName).slice(0, 120),
          currencyCode: paymentCurrency,
          contractCode: config.contractCode,
          redirectUrl
        });
        const provider = initialized.responseBody || {};
        if (!checkoutUrlIsSafe(provider.checkoutUrl)) {
          const error = new Error("Monnify did not return a valid checkout URL.");
          error.code = "MONNIFY_CHECKOUT_URL_INVALID";
          throw error;
        }
        checkoutUrl = provider.checkoutUrl;
        transactionReference = provider.transactionReference || null;
        providerResponse = { transactionReference, enabledPaymentMethod: provider.enabledPaymentMethod || [] };
      }
      await pool.query(
        "UPDATE vf_payments SET checkout_url = $2, transaction_reference = $3, status = 'pending', provider_response = $4::jsonb, updated_at = NOW() WHERE payment_reference = $1",
        [paymentReference, checkoutUrl, transactionReference, JSON.stringify(providerResponse)]
      );
      await pool.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'checkout_created', $2, $3::jsonb)",
        [orderId, "Secure " + paymentCurrency + " " + (paymentMethod === "squad" ? "Squad" : "Monnify") + " checkout was created.", JSON.stringify({ paymentReference, amountMinor: paymentAmountMinor, currency: paymentCurrency, retailUsdMinor: quote.salePriceCents, usdNgnRate: checkoutAmount.usdNgnRate })]
      );
      return sendJson(res, 200, {
        ok: true, checkoutUrl: provider.checkoutUrl, paymentReference,
        orderNumber, productName: quote.productName, amountMinor: paymentAmountMinor, currency: paymentCurrency,
        usdAmountMinor: quote.salePriceCents, usdNgnRate: checkoutAmount.usdNgnRate,
        provider: paymentMethod,
        note: "Payment is verified against the amount and currency received from the selected gateway before supplier fulfilment begins."
      });
    } catch (error) {
      await pool.query(
        "UPDATE vf_payments SET status = 'failed', provider_status = 'INITIALIZATION_FAILED', updated_at = NOW() WHERE payment_reference = $1",
        [paymentReference]
      ).catch(() => {});
      await pool.query(
        "UPDATE vf_orders SET status = 'failed', updated_at = NOW() WHERE id = $1 AND status = 'awaiting_payment'",
        [orderId]
      ).catch(() => {});
      await pool.query(
        "INSERT INTO vf_order_events (order_id, event_type, message, details) VALUES ($1, 'checkout_failed', 'Monnify could not initialize the checkout session.', $2::jsonb)",
        [orderId, JSON.stringify({ code: error.code || "MONNIFY_INITIALIZATION_FAILED" })]
      ).catch(() => {});
      console.error("[orders/create/" + paymentMethod + "]", error.code || error.message);
      return sendJson(res, 502, { ok: false, error: "Secure checkout could not be started. No supplier order was placed." });
    }
  } catch (error) {
    console.error("[orders/create]", error.code || error.message);
    const status = error.status === 400 ? 400 : error.status === 404 ? 404 : error.status === 409 ? 409 :
      error.code === "SUPPLIER_NOT_CONFIGURED" ? 503 :
      error.code === "COUNTRY_UNAVAILABLE" || error.code === "INVALID_DURATION" ? 400 : 503;
    const messages = {
      COUNTRY_UNAVAILABLE: "SMS verification and long-term rentals currently use US numbers only.",
      PRODUCT_UNAVAILABLE: "That product is currently unavailable. Please refresh the catalogue.",
      PRODUCT_NOT_FOUND: "That product could not be found. Please refresh the catalogue.",
      INVALID_DURATION: "Choose one of the available rental periods.",
      MONNIFY_LIVE_LOCKED: "Live payments are not enabled for this VerifyFlow account.",
      MONNIFY_CONFIG_MISSING: "Monnify checkout is not fully configured yet.",
      SQUAD_CONFIG_MISSING: "Squad checkout is not fully configured yet.",
      CHECKOUT_EXCHANGE_RATE_MISSING: "Local NGN checkout is not configured yet. Please contact support.",
      CHECKOUT_EXCHANGE_RATE_INVALID: "The local checkout exchange rate is invalid. Please contact support.",
      SUPPLIER_NOT_CONFIGURED: "The supplier catalogue is temporarily unavailable.",
      SUPPLIER_PRICE_INVALID: "A current product price could not be confirmed.",
      INVALID_PRODUCT: "Please select a valid product from the catalogue.",
      INVALID_CATALOG_SELECTION: "That product selection is no longer valid. Refresh the catalogue and try again."
    };
    return sendJson(res, status, { ok: false, error: messages[error.code] || "We couldn't prepare this order. Please refresh the catalogue and try again." });
  }
};
