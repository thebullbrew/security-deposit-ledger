# Security Deposit Ledger

A free landlord tool from **The Bull Brew**. Track security deposits per tenant, accrue the
interest you owe, never miss a return deadline, and generate printable itemized deduction
letters at move-out.

## Features

- **Per-tenant deposit records** — tenant, unit, amount, date received, escrow account label
- **Interest tracker** — daily accrual at your bank's rate; NJ framing included (under-10-unit
  properties must use separate interest-bearing accounts)
- **Move-out flow** — move-out date → return-deadline countdown (amber/red states) → deductions
  builder (cleaning, repairs, unpaid rent + notes) → printable itemized statement letter
- **Dashboard** — total deposits held, upcoming deadlines, per-tenant status (held / move-out
  pending / returned)
- **Local-first** — everything in `localStorage`; JSON export/import; no backend, no tracking

## Run it

Open `docs/index.html` in any browser, or serve the `docs/` folder:

```bash
cd docs && python3 -m http.server 8080
```

Live: https://thebullbrew.github.io/security-deposit-ledger/

## Stack

Static HTML + CSS + JS. No build step, no dependencies (Google Fonts via CDN with serif
fallbacks). Dark old-money design system: `#13211A` / `#F5F2E8` / `#B49A5B`, Cormorant Garamond.

## Disclaimer

This tool tracks your numbers; it is not legal advice. Deposit deadlines, interest rules, and
deduction laws vary by state — verify yours with local counsel.
