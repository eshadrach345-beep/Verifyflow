# VerifyFlow

VerifyFlow is a customer-facing marketplace for SMS verification, long-term number rentals, dedicated numbers, eSIM data and mobile proxies.

## Customer flow

1. A customer signs in and chooses a product from the live supplier catalogue.
2. VerifyFlow re-checks the supplier price on the server. Browser-submitted prices are never trusted.
3. The server saves an order, a supplier-price snapshot and a payment record, then requests a hosted Monnify checkout in USD.
4. The Monnify return page and webhook both verify the transaction directly with Monnify. The webhook signature is checked in LIVE mode.
5. Only a verified, correctly priced and correctly denominated payment can create a durable VoidMob fulfilment job.
6. The supplier request uses a permanent per-order idempotency key. Supplier order ID, status, cost and service details are saved against the order.
7. Customers see their orders in their account and can refresh a pending supplier status. The admin dashboard shows sales, estimated supplier costs, queue status and jobs requiring attention.

The fixed NGN 100 sandbox test page remains a payment integration test only. Its order metadata explicitly prevents service fulfilment.

## Database setup

The application requires PostgreSQL (Neon is supported). Configure `DATABASE_URL` as a server-side environment variable, then run:

~~~bash
npm install
npm run db:migrate
npm run check
~~~

The migrator applies numbered migrations in order. Migrations 003 and 004 create the supplier fulfilment queue and per-customer checkout idempotency index. They must be applied before enabling the new customer checkout or payment webhook flow. Never put database credentials in browser code or send them in chat.

## Monnify setup

Set these server-side Vercel environment variables:

- `MONNIFY_API_KEY`
- `MONNIFY_SECRET_KEY`
- `MONNIFY_CONTRACT_CODE`
- `MONNIFY_ENVIRONMENT=SANDBOX` for testing

Configure Monnify's Transaction Completion webhook URL as:

~~~text
https://verifyflow-five.vercel.app/api/payments/webhook
~~~

The existing NGN 100 sandbox page uses a dedicated test order and never submits a supplier purchase.

### USD / international checkout

Supplier catalogue prices are in USD, so retail checkout requests a USD card transaction. Monnify must enable USD international payments on this particular merchant account before `MONNIFY_INTERNATIONAL_ENABLED=true` is set. This capability is not assumed to be enabled. Monnify's current documentation says international USD checkout is available to customers in 150+ countries, but supports Mastercard only and requires activation under Settings > Contract Setup. The international USD settlement documentation states T+3 settlement and a 15% rolling reserve held for 90 days. Monnify's current pricing help lists a 4% international-card collection fee; verify the applicable fee and reserve terms in your own merchant contract. These costs are not included in VerifyFlow's displayed gross-margin estimate.

Do not switch `MONNIFY_ENVIRONMENT` to LIVE until Monnify has approved VerifyFlow's actual business model and product categories in writing, live credentials are installed, the webhook is configured, and payment/fulfilment/refund tests have passed. Live payments are also guarded by `MONNIFY_LIVE_ENABLED=true` and `MONNIFY_PRODUCT_APPROVAL_CONFIRMED=true`. Retail order creation in LIVE additionally requires `VERIFYFLOW_LIVE_ORDERS_ENABLED=true`.

Sandbox webhook notifications may omit the production signature; every referenced transaction is still verified server-to-server. LIVE webhook requests require HMAC-SHA512 signature validation.

## VoidMob supplier setup

Set `VOIDMOB_API_KEY` as a server-side Vercel environment variable. The key must have the required Buy permission for the products VerifyFlow intends to supply. Set a conservative per-order spend cap and rolling daily spend cap in the VoidMob key/account settings. Never expose the key in browser code, logs, source files or chat.

The catalogue endpoint only reads product prices and stock. Actual purchases are separate POST requests and debit the prepaid VoidMob balance. VerifyFlow supports these legitimate connectivity services:

- SMS verification (VoidMob currently supplies US numbers for this category)
- Long-term number rentals (US numbers, supported terms only)
- Dedicated numbers (countries shown as in stock by VoidMob)
- eSIM plans
- Mobile proxy plans

Supplier auto-purchasing is disabled unless both of these server-side Vercel variables are explicitly set after the owner has configured the VoidMob Buy permission and spending limits:

- `VOIDMOB_FULFILMENT_ENABLED=true`
- `VOIDMOB_AUTOBUY_CONFIRMED=true`

Do not set these flags just to test the website. Tests use mocked supplier responses and do not debit the VoidMob balance. When these flags are off, verified customer orders can be queued for admin review but no supplier purchase is sent.

For launch, set `MONNIFY_INTERNATIONAL_ENABLED=true` only after the merchant account has actually been enabled for the relevant USD checkout route. Keep the application in SANDBOX while testing; the supplier auto-buy flags are independent of Monnify's environment.

## Social marketing supplier connections

VerifyFlow has a protected, read-only supplier monitor for Peakerr and JustAnotherPanel at `/api/admin/suppliers`. The admin dashboard can display each supplier wallet balance and synchronize its current service list. Set these server-side Vercel environment variables:

- `PEAKERR_API_KEY`
- `JUSTANOTHERPANEL_API_KEY`
- Optional pricing controls: `VERIFYFLOW_SMM_MARKUP_PERCENT=40` and `VERIFYFLOW_SMM_MIN_MARKUP_CENTS=25`

The supplier keys are never sent to browser code. The monitor currently reads the documented `balance` and `services` actions only; it does not place orders. The customer-facing catalogue allowlist is restricted to clearly described creative/marketing work (for example content creation, video editing, design, advertising campaign management and audits). Engagement inflation, purchased traffic, reviews, backlinks and similar metric-manipulation services are excluded. If a provider has no eligible services, its eligible count will correctly show zero. Supplier service rates and currency must be confirmed before any future checkout or fulfilment integration is enabled.

## Fulfilment and exceptions

Supplier orders are submitted with a stable per-order idempotency key. If a request times out or its outcome is uncertain, the job is marked `unknown` and VerifyFlow will not create a new purchase key. The admin's reconciliation action resubmits only with the same key so VoidMob can return the original result or report that it is still processing.

Supplier services such as eSIMs and mobile proxies can take time to provision. Customers can refresh their supplier status from the account page. The current implementation does not run a background polling worker.

A definitive supplier rejection after a customer payment is flagged as a failed order and visible in the admin queue. Automated Monnify refunds are not implemented yet; the merchant must review the failed payment and issue any required refund from the Monnify dashboard. Do not advertise automatic refunds until this has been built and tested. Unknown outcomes must be reconciled before any refund or repeat purchase decision.

VoidMob supplier deposits are not automated. The admin dashboard separates customer sales from saved supplier-cost estimates/charges; the owner must fund the supplier wallet separately and monitor the balance.

## Admin dashboard

The protected operations dashboard is available at `/admin.html`. Set `VERIFYFLOW_ADMIN_EMAILS` as a server-side comma-separated list of the exact authorized VerifyFlow account email addresses. Admin access requires an active signed-in session and an email allowlist match.

The admin dashboard shows recent orders, customer sale totals, supplier cost estimates/charges, fulfilment status and error details. The fulfilment queue allows an admin to submit a queued paid order after the supplier auto-buy safeguards are enabled. An unknown outcome has a separate same-key reconciliation action. Never create a new supplier purchase to resolve an uncertain outcome.

Vercel currently reports the connected OmniPulse team on the Hobby plan. Its current plan terms describe Hobby as for personal, non-commercial use. Verify the plan is appropriate for a commercial storefront and upgrade before taking live customer orders if required by Vercel's terms.

## Admin launch-readiness report

The protected admin dashboard includes a live configuration report at `/api/admin/readiness`. It checks the PostgreSQL connection, required schema migrations and tables, admin allowlist, required server-side environment-variable presence, and owner confirmation flags. The report never returns secret values.

The report distinguishes configured variables from manual verification. In particular, it cannot prove that Monnify approved the business, that USD card processing is enabled on the merchant account, that supplier permissions and balances are adequate, or that legal/tax obligations have been satisfied. The Peakerr and JustAnotherPanel entries remain optional, read-only monitors; neither provider is wired into customer checkout or fulfilment.

Before live launch, configure and verify the following on the **VerifyFlow** Vercel project:

- `VERIFYFLOW_LEGAL_BUSINESS_NAME`, `VERIFYFLOW_BUSINESS_ADDRESS`, and `VERIFYFLOW_SUPPORT_EMAIL` using real, monitored business details.
- `VERIFYFLOW_MONNIFY_WEBHOOK_CONFIRMED=true` only after the production webhook URL has been configured and successfully tested.
- `VERIFYFLOW_POLICIES_REVIEWED=true` only after the Terms, Privacy and Acceptable Use pages have been completed and reviewed.
- `VERIFYFLOW_TAX_SETUP_CONFIRMED=true` only after tax registration, collection and invoicing requirements have been checked for intended markets.
- `VERIFYFLOW_REFUND_PROCESS_CONFIRMED=true` only after a manual refund and customer-notification process has been documented. Automated refunds are not implemented.
- The existing live payment and VoidMob fulfilment flags only after Monnify and supplier approvals, safe spending limits, sandbox tests and reconciliation tests are complete.

A green configuration item is not a guarantee of launch approval. Keep live orders disabled until every external provider, legal, operational and deployment check has been completed.

## Tax and launch readiness

The current storefront shows USD supplier/retail prices but does not calculate, collect or remit VAT/sales tax. The displayed amount is not a tax-compliant global landed price. Before selling in a country, obtain advice on the seller's registration, invoicing, VAT/sales tax, consumer cancellation/refund rights, privacy and acceptable-use obligations, and configure tax collection for the relevant markets.

Policy pages are draft templates. Replace them with reviewed terms, your actual business identity, monitored contact details and jurisdiction-specific policies before launch.

## Validation and deployment

Run:

~~~bash
npm run check
~~~

Git pushes to the production branch trigger the GitHub validation workflow and the connected Vercel deployment. A successful GitHub check does not by itself mean the Vercel deployment or database migrations have completed. Confirm both before using the live domain.
