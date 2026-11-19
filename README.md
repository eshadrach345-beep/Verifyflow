# VerifyFlow

VerifyFlow is a customer-facing marketplace for SMS verification, long-term number rentals, dedicated numbers, eSIM data, and mobile proxies.

## What is currently implemented

- Responsive storefront, customer registration/sign-in, customer sessions, and order-history reads.
- Read-only product discovery for supported VoidMob catalogues.
- Monnify server-side authentication, hosted Sandbox checkout, authenticated payment verification, and webhook verification.
- A sandbox-only test page. The fixed NGN 100 test payment does not deliver a service.
- Live Monnify payments are locked unless explicit launch and product-approval environment flags are enabled.
- Customer wallet balances remain disabled.
- Automated syntax checks, inline browser-script parsing, and helper tests.

## Database setup

Customer accounts, orders, and payment records require the Neon PostgreSQL migrations.

Configure DATABASE_URL as a server-side Vercel environment variable, then run:

~~~bash
npm install
npm run db:migrate
npm run check
~~~

The migration runner applies all numbered SQL migrations in order and records applied versions in vf_schema_migrations. Never put database credentials in browser code.

## Monnify configuration

Set these server-side Vercel environment variables:

- MONNIFY_API_KEY
- MONNIFY_SECRET_KEY
- MONNIFY_CONTRACT_CODE
- MONNIFY_ENVIRONMENT = SANDBOX

Never commit Monnify credentials or share the secret key in chat.

After deployment and database migration, sign in to VerifyFlow and open /payment-test.html. The fixed NGN 100 sandbox checkout is only an integration check and does not fulfil any service.

Configure Monnify's Transaction Completion webhook URL as:

~~~text
https://verifyflow-five.vercel.app/api/payments/webhook
~~~

Sandbox notifications do not include the production signature. The sandbox webhook handler still verifies each referenced transaction directly with Monnify before updating its status. Production notifications require HMAC-SHA512 signature validation.

## Live payments

Live checkout is disabled by default. Do not enable MONNIFY_LIVE_ENABLED or MONNIFY_PRODUCT_APPROVAL_CONFIRMED until Monnify has accepted VerifyFlow's actual business model and product categories in writing, international payment settings have been confirmed, and live credentials have been configured. Customer wallet top-ups are not enabled.

The sandbox test endpoint does not fulfil a service. Real retail checkout still requires an approved server-side price book, supplier purchase integration, refund/reconciliation handling, and idempotent fulfilment.

## Supplier configuration

Set VOIDMOB_API_KEY as a server-side Vercel environment variable to load supplier-backed catalogues. Catalogue reads do not submit purchases.

The HeroSMS Account API key is not itself the customer-number purchase API. Confirm the separate purchase integration with HeroSMS before retail SMS sales are enabled.

## Validation

~~~bash
npm run check
~~~

## Deploy

Git pushes to the production branch trigger deployment and the GitHub validation workflow.

## Legal

Policy pages are draft templates. Replace them with reviewed terms, your actual business identity, and monitored contact details before launch.
