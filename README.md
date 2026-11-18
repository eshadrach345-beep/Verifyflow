# VerifyFlow

Customer-facing storefront foundation for SMS verification, long-term number rentals, eSIM data and mobile proxy products.

## Current status

This is an initial deployable storefront foundation, not a complete transactional marketplace. Included: homepage, service overview, dashboard preview, draft policy pages and health endpoint.

Not yet enabled: customer authentication, supplier API fulfilment, live catalogues, checkout, refunds, webhooks, admin operations and order management. Do not accept customer payments until these features are implemented, tested and the payment provider has approved the exact business model and product categories.

## Deploy

Import this repository into Vercel and deploy from the main branch. No build command or environment variables are required for the static preview.

Health endpoint: /api/health

## Security

Never commit API keys, database credentials, payment secrets or authentication secrets. Add them as encrypted server-side environment variables only after the corresponding integration is implemented.

## Legal

Policy pages are draft templates. Replace them with reviewed terms, actual business identity and monitored contact details before launch.
