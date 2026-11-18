# VerifyFlow

VerifyFlow is a customer-facing marketplace for SMS verification, long-term number rentals, dedicated numbers, eSIM data, and mobile proxies.

## What is currently implemented

- Responsive storefront and service-category pages.
- Customer registration and sign-in endpoints using scrypt password hashes and HttpOnly session cookies.
- Customer session lookup and sign-out.
- Customer order-history read endpoint.
- Read-only product discovery for supported VoidMob catalogues, including eSIM plans, proxy plans, dedicated-number country availability, and long-term rental availability.
- Customer-facing service pages do not expose supplier credentials, supplier connection diagnostics, database schema state, or payment-approval notes.
- Admin database diagnostics are restricted to the `VERIFYFLOW_ADMIN_SECRET` bearer credential.
- Automated syntax checks, inline browser-script parsing, and mocked catalogue/authentication smoke tests.

## Database setup

Customer accounts and order history require the Neon PostgreSQL migration.

Configure `DATABASE_URL` as a server-side Vercel environment variable, then run:

```bash
npm install
npm run db:migrate
npm run check
```

The migration is idempotent and creates the customer, session, wallet, order, and order-event tables. The database status endpoint is administrative only and requires:

```http
Authorization: Bearer <VERIFYFLOW_ADMIN_SECRET>
```

Never put database credentials or the admin secret in browser code.

## Supplier configuration

Set `VOIDMOB_API_KEY` as a server-side Vercel environment variable to load the supplier-backed catalogues. The API reads catalogue data only; it does not submit purchases.

The HeroSMS Account API key is for partner-account management, pricing, balance, and statistics. It is not itself a customer-number purchase API. HeroSMS's Protocol API and Custom API require a separate partner-number integration and must be configured and tested with the supplier before retail sales are enabled.

## Purchases and payments

Customer purchase fulfilment, wallet top-ups, checkout, payment verification, refunds, supplier callbacks, and purchase webhooks are not implemented yet. Do not accept real customer payments or trigger supplier purchases until those flows are implemented and tested end to end, retail pricing is configured, and the payment provider has approved the exact reseller business model and product categories.

VoidMob purchase endpoints can spend the prepaid supplier wallet. Catalogue reads in this project do not spend funds.

## Validation

```bash
npm run check
```

This runs Node syntax checks, parses inline scripts from the customer pages, tests password/session helper behavior, and uses mocked supplier responses to validate catalogue mapping and safe error handling.

## Deploy

Import the repository into Vercel and connect the production branch. Git pushes trigger deployment and the GitHub validation workflow.

## Legal

Policy pages are draft templates. Replace them with reviewed terms, your actual business identity, and monitored contact details before launch.
