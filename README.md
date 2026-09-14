# A6 Dashboard

Area 6 Marketing's eCommerce analytics dashboard, deployed separately for each
client (currently Rocknot and Kailee P). A Next.js 14 app for DTC Shopify brands: live revenue and ad
spend (Overview), per-platform ad performance, creative analysis with
AI-written production briefs, top products, customer intel, inventory and
restock alerts, returns, Klaviyo retention planning, attribution, a marketing
calendar with launch checklists, goals, tasks, AI insights and an in-house AI
analyst ("Cleo"). Data flows Windsor.ai → BigQuery (plus live Shopify, Meta,
Snapchat and Windsor REST overlays); AI features use the Anthropic API.

The same codebase deploys once **per client**, as its own Vercel project with
its own credentials, data stores and user list — clients never share a
deployment, a database, a Google Sheet or a login. Everything brand-specific
lives in one file — `src/lib/client.ts` — and the deployment picks its
profile from env vars.

## Client profiles

| Profile   | `CLIENT` | Platforms                      | Inventory model | Notes |
|-----------|----------|--------------------------------|-----------------|-------|
| Rocknot   | `rocknot`| Meta, Google, TikTok, Snapchat | `rocknot-bags` (hand-audited bag/strap rules) | original deployment |
| Kailee P  | `kaileep`| Meta, Google, Pinterest        | `standard` (one row per Shopify variant) | bridal shoes, kaileep.com |

How the active client is chosen, in order:

1. `CLIENT` env var (`rocknot` or `kaileep`)
2. `BQ_DATASET` env var, when it is named after a known client
3. otherwise `kaileep`

The existing Rocknot Vercel project has `BQ_DATASET=rocknot`, so it keeps
resolving to Rocknot without any change. Set `CLIENT` explicitly on every
new deployment anyway.

What the profile controls: name/wordmark/logo/accent colours, Shopify store
domain fallback, which ad platforms are queried and shown, the Meta ad-account
filter for Windsor's shared facebook feed, the QuickBooks entity filter, MER
and ROAS goals, the default annual target, the inventory model, the AI
prompts' brand description and founder on-camera creative track, pinned
Drive folders on the Creative Analysis tab, alert sender name, and whether
Rocknot's one-time seed routes are enabled.

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npx tsc --noEmit   # typecheck
npm run build      # production build (also lints)
```

With no env vars the app runs on mock data and auth is off.

## Environment variables

Core (every client):

| Variable | Purpose |
|---|---|
| `CLIENT` | `rocknot` or `kaileep` — selects the profile |
| `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in; auth is enforced only once all three exist |
| `AUTH_ADMINS`, `AUTH_MEMBERS` | comma-separated emails; env admins are permanent |
| `CALENDAR_SHEET_ID`, `PRIVATE_SHEET_ID` | Google Sheets used as the app's small data store (calendar, tasks, goals, users, briefs) |
| `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_KEY`, `BQ_DATASET` | BigQuery data layer — see `SETUP_BIGQUERY.md` |
| `WINDSOR_API_KEY` | Windsor REST fallback + live per-platform overlays |
| `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN` | live ShopifyQL revenue, inventory, products, returns |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | only for the one-time `/api/shopify/auth` token flow |
| `META_AD_ACCOUNT_ID`, `META_ACCESS_TOKEN` | live Meta spend + creative media; the account id also filters Windsor's multi-client feed |
| `META_ACCOUNT_NAME` | optional override of the profile's Meta account-name filter |
| `ANTHROPIC_API_KEY` | Cleo, insights, briefs, retention plans, brand-guide extraction |
| `KLAVIYO_API_KEY` | Retention tab |
| `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REFRESH_TOKEN`, `QB_REALM_ID` | QuickBooks P&L (Financials tab); set up via `/api/debug/qb-oauth` |
| `CRON_SECRET`, `SLACK_RESTOCK_WEBHOOK_URL`, `RESEND_API_KEY`, `RESTOCK_EMAIL_TO`, `RESTOCK_EMAIL_FROM` | Monday restock alert (`vercel.json` cron) |

Rocknot-only: `SNAP_CLIENT_ID`, `SNAP_CLIENT_SECRET`, `SNAP_REFRESH_TOKEN`,
`SNAP_AD_ACCOUNT_ID` (live Snapchat spend).

## Onboarding a new client (Kailee P checklist)

1. **Profile** — `src/lib/client.ts` already has `kaileep`. Fill in the
   blanks as they arrive: `dashboardUrl` (the Vercel URL you pick),
   `brand.aov`, `creatives.driveFolders`, and `goals` once the annual net-sales
   target and MER/ROAS goals are agreed. Drop the logo at
   `public/kaileep-logo.png` (until then the sidebar shows a "K" mark).
2. **BigQuery** — create dataset `kaileep` and Windsor destination tasks for
   `shopify_orders`, `shopify_customers`, `facebook_ads`, `google_ads`,
   `pinterest_ads` (see `SETUP_BIGQUERY.md`). Verify the Pinterest column
   names with `/api/debug/bq-schema` after the first sync — the queries try
   `total_checkout_value`/`total_checkout`, then
   `total_conversions_value`/`total_conversions`, then spend-only.
3. **Vercel** — new project from this repo with `CLIENT=kaileep`,
   `BQ_DATASET=kaileep`, the core variables above, Kailee P's Shopify store
   domain/token, Meta ad account id/token, Klaviyo key, and her own
   `CALENDAR_SHEET_ID` / `PRIVATE_SHEET_ID` sheets (never reuse Rocknot's —
   they hold Rocknot's calendar, tasks, goals and chat history).
4. **Access** — put the agency admins in `AUTH_ADMINS`; add Kailee P's team
   (Michelle, Astrid, Karina, Ting, Lauren) from the Team & Access tab.
5. **Brand guide** — upload Kailee P's brand guidelines on the Creative
   Analysis tab so briefs and retention copy follow the real brand.
6. **Goals** — enter the annual net-sales target on the Goals tab (the tab
   asks for it until one is saved).

The Rocknot deployment needs no changes; `BQ_DATASET=rocknot` resolves to the
Rocknot profile automatically.
