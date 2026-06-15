# BigQuery Setup — Windsor → BigQuery → Dashboard

This makes BigQuery the data layer: Windsor syncs each client's data into a
per-client BigQuery dataset on a schedule, and the dashboard queries those
tables. This eliminates the Windsor REST API problems (row truncation,
report-mixing restrictions, date-preset mismatches) and makes onboarding a
new client a configuration task instead of a code change.

## 1. Google Cloud project (one-time, ~15 min)

1. Go to https://console.cloud.google.com and create a project
   (e.g. `agency-dashboards`).
2. In the left menu: **BigQuery** → it activates automatically on first open.
3. In BigQuery, click the three dots next to your project name →
   **Create dataset**:
   - Dataset ID: `rocknot` (one dataset per client — use the client name)
   - Location: `US` (multi-region)
   - Leave everything else default → **Create dataset**

## 2. Service account for the dashboard (~10 min)

1. Left menu: **IAM & Admin → Service Accounts** → **Create service account**
   - Name: `dashboard-reader`
2. Grant it these roles:
   - `BigQuery Data Viewer`
   - `BigQuery Job User`
3. After creating: click the account → **Keys** tab → **Add key** →
   **Create new key** → JSON → download.
4. Open the downloaded JSON file. You'll paste its full contents into Vercel
   in step 4.

## 3. Windsor destination tasks (~15 min)

In Windsor (https://onboard.windsor.ai), for **each** connector create a
destination task to BigQuery. Windsor docs: Destinations → Google BigQuery.

Create these five tasks, all pointed at the `rocknot` dataset, scheduled
**hourly**:

| Connector        | Fields to sync                                                                 | Table name          |
|------------------|--------------------------------------------------------------------------------|---------------------|
| Shopify (Orders) | date, order_id, order_customer_id, order_total_price, order_gross_sales, order_net_sales | `shopify_orders`    |
| Shopify (Customers) | customer_id, customer_is_returning                                          | `shopify_customers` |
| Facebook Ads     | date, spend, impressions, clicks, purchase_roas, conversions                   | `facebook_ads`      |
| Google Ads       | date, spend, impressions, clicks, conversions, conversion_value                | `google_ads`        |
| TikTok Ads       | date, spend, impressions, clicks, conversions, conversion_value                | `tiktok_ads`        |
| Shopify (Order Status) | date, order_id, order_cancelled_at                                       | `shopify_order_status` |

The `shopify_order_status` task is optional. The dashboard does not currently
use it for revenue/order calculations (see "Revenue, orders, AOV and customer
formulas" below) — excluding cancelled orders moved both the order count and
revenue total further from Shopify's reported figures, so it's left
unfiltered. The table is still queried for diagnostics in
`/api/debug/orders`. Adding new fields later should follow this same pattern:
a small dedicated task per field group, rather than editing existing tasks.

**Important:** the table names must match exactly — the dashboard queries
these names. Orders and Customers must be two separate tasks (Windsor cannot
mix the two reports in one query; that's what broke the REST integration).

Windsor will need authorization to write to BigQuery — it walks you through
a Google OAuth grant when you pick BigQuery as the destination.

## 4. Vercel environment variables

In the Vercel project → Settings → Environment Variables, add:

| Variable                  | Value                                              |
|---------------------------|----------------------------------------------------|
| `GCP_PROJECT_ID`          | your project id (e.g. `agency-dashboards`)         |
| `GCP_SERVICE_ACCOUNT_KEY` | the full JSON key file contents (paste as one line) |
| `BQ_DATASET`              | `rocknot`                                          |

Then redeploy. The dashboard automatically switches to BigQuery when these
three variables are present — the Windsor REST path stays as fallback, so
nothing breaks if they're missing.

You can verify it switched: the live indicator data source will be
`bigquery_live` (visible in the network tab on `/api/windsor` responses).

## 5. Onboarding the next client

1. Create a new dataset in the same project (e.g. `clientname`)
2. Create the same five Windsor destination tasks for the client's
   connectors → the new dataset
3. Deploy another Vercel instance of this repo (or a per-client subdomain)
   with `BQ_DATASET=clientname`

No code changes.

## Revenue, orders, AOV and customer formulas

Windsor syncs `shopify_orders` as **one row per order per sync-relevant
date**: an original row on the order's placement date, plus an extra row on
each later date a refund/adjustment was synced. There's no clean "final
total" column, so the dashboard has to pick a formula and the only way to
validate it is against Shopify's own Analytics reports for a fixed date
range (Jan 1 – Jun 15, 2026 was used as the reference range, compared
against Shopify Admin → Analytics → Reports).

The formulas landed on (all in `dedupedOrdersCte()` in `src/lib/bigquery.ts`,
used by `bqOverview.ts` and `bqCustomers.ts`):

- **One row per order**, grouped by `order_id` (falling back to a per-row key
  for the rare null-`order_id` rows so they aren't dropped).
- **Revenue / order date** = the order's **first-synced** `order_total_price`,
  attributed to `MIN(date)` across that order's rows. Matches Shopify's
  Total Sales / Orders within ~0.6%. (Tried and rejected: summing
  `order_total_price` across all of an order's rows — produces nonsensical
  negative totals for some orders; excluding cancelled orders via
  `shopify_order_status` — moved the totals *further* from Shopify's
  numbers.)
- **AOV** = total **first-synced `order_net_sales`** ÷ order count (not
  `order_total_price`). Matches Shopify's reported AOV within ~0.1%, vs
  ~2.5% off using `order_total_price`.
- **New vs. returning customers** (Overview cards) replicates Shopify's
  "New customer sales over time" report: a customer is "new" if their
  first-ever order (by `MIN(order_date)`, all-time, not just the selected
  range) falls within the selected range — and their counted revenue is
  *just that first order*, not all their orders in the range (Shopify's
  New segment always has Orders == Customers). "Returning" customers'
  revenue is the sum of all their orders placed within the range. Matches
  Shopify's New customers/revenue within ~1-2%.
  - Note: Shopify's separate "Returning customer rate" cohort report uses a
    *different* definition (lifetime repeat-purchase status, not order
    timing) and gives a noticeably different split (e.g. 41% vs ~25%
    returning for the same range). The New customer sales report was chosen
    because it's the one with a matching revenue breakdown.

**If these numbers ever look wrong again**: don't re-derive the formula from
scratch. Use `/api/debug/orders?from=YYYY-MM-DD&to=YYYY-MM-DD` (temporary
diagnostic endpoint) — it computes `dashboard_calculation`, `aov_candidates`,
and `customer_stats` so they can be diffed against a fresh Shopify report for
the same range. A ~1-2% gap is expected and is inherent to Windsor's
duplicate-row sync model; don't chase an exact match.

## Troubleshooting

- **Numbers look wrong** → query the table directly in the BigQuery console
  (e.g. `SELECT * FROM rocknot.shopify_orders ORDER BY date DESC LIMIT 50`)
  and compare with Shopify admin. This shows immediately whether the issue
  is Windsor's sync (data wrong in the table) or the dashboard (data right
  in the table).
- **Column name mismatches** — if Windsor lands columns under different
  names than expected, the query lives in `src/lib/bqOverview.ts` and the
  names are adjusted in one place.
