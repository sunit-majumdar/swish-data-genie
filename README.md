# Swish Data Genie

Static single-page app (HTML/JS + sql.js). Loads `data/customers.csv` into an in-memory `customers` table and runs one parameterised SQL template driven by four dropdowns (city, channel, signup month, status).

- Data is synthetic and frozen at 15 Sep 2026. The app never queries BigQuery.
- Statuses describe customers, not single orders. Active = order_count >= 1 and last_order_date >= 2026-08-17; Lapsed = order_count >= 1 and last_order_date < 2026-08-17; No delivered order = order_count = 0.
- Guardrails (dropdowns only, one SQL template with bound parameters, 50-row preview, 2,000-row CSV cap) are a design demonstration; real guardrails would be server-side.
- Run locally: `python -m http.server`, open http://localhost:8000. Deploy by publishing this folder on GitHub Pages (sql.js is vendored in `vendor/`).
