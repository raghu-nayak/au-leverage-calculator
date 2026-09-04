# Debt Recycling &amp; Leverage Calculator (Australia)

**[Open the calculator →](https://raghu-nayak.github.io/au-leverage-calculator/)**

Three ways of borrowing to invest, under Australian tax, each measured against
the one thing most calculators leave out: **not borrowing at all.**

- **Debt recycling** — pay cash off the home loan, draw it again through a
  separate split, invest it. The debt stays the same size; the interest on the
  converted part becomes deductible.
- **Borrow to invest** — draw a lump against your home and invest it.
  Deductible interest, no margin calls, and your house as security.
- **Margin loan** — borrow against the portfolio itself, at a higher rate, with
  a lender who can force a sale if the gearing climbs past its limit.

One self-contained HTML file. No build step, no dependencies, no network
requests, no tracking. Works the same opened from disk as it does served.

## What it answers

| | |
|---|---|
| **Break-even return** | The return at which the borrowing stops paying for itself. Found by bisection on the full projection, not a formula. |
| **Ahead in _x_% of markets** | 1,000 simulated markets, both sides seeing the same market in each run. |
| **What it costs to hold** | Year by year: deductible interest and principal below the line, income and tax saved above it. |
| **Margin-call risk** | How often a call arrives, how far the gearing gets, and what settling one costs. |
| **Good debt vs bad debt** | For recycling: the balance barely moves, and what changes is how much of it is working. |

The headline is measured **after closing the position** — sell up, pay capital
gains tax on the discounted gain at your marginal rate, clear the debt — with
both sides measured the same way. A geared position that only looks ahead while
the tax is still deferred is not ahead.

## The tax it models

FY **2026-27** Australian resident rates, in
[`data/au-tax.json`](data/au-tax.json):

- resident marginal rate scale (the lowest positive rate is 15% from 1 July 2026)
- Medicare levy with its low-income shade-in
- Medicare levy surcharge, including the **net investment loss add-back** — so
  negative gearing cuts your income tax without moving you down a surcharge tier
- low income tax offset
- 50% CGT discount, capital losses offsetting gains only and applied before the
  discount
- franking credits grossed up at the 30% company rate and refunded

Thresholds are indexed with inflation unless you switch that off.

Tax is worked out on **one person's income**. The couple-or-family switch raises
the Medicare levy and surcharge thresholds and does nothing else: there is no
income splitting, no partner's income, and dependent children — which raise both
thresholds again — are not modelled. The per-child amounts are in the JSON for
anyone who wants to add them.

`data/au-tax.json` is the source of truth. The page cannot fetch it at runtime
without breaking the no-network-requests rule, so
[`tools/embed.py`](tools/embed.py) inlines the fields the engine reads:

```sh
tools/embed.py            # rewrite the inlined block from the JSON
tools/embed.py --check    # exit 1 if the page has drifted from the JSON
```

The JSON also carries the notes, the ATO source links and the deductibility
rules that no calculator can apply for you — those stay in the file, for people.

## How the projection works

One pass per year, in actual dollars, with **two ledgers and one market**. The
geared plan and the plain alternative are handed the same return every year, so
the difference between them is the borrowing and never a luckier draw. With the
borrowing set to nothing the two ledgers agree to the cent, which is the test
that keeps the comparison honest.

A few details that are easy to get wrong and are done properly here:

- **The freed repayment.** When a home loan is repaid the money that was
  servicing it goes somewhere else. Both sides are credited with it the year it
  frees up — the plain side clears its loan years earlier, and crediting only
  one side would quietly reward whichever stays in debt longest.
- **A margin call is settled back to the lender's maximum, not the buffer.**
  Selling moves both the loan and the portfolio, so closing a gap of _g_ takes
  _g_/(1−LVR).
- **Gearing up moves the denominator too.** Borrowing _A_ raises the portfolio
  by _A_, so holding a target LVR takes (L·port − loan)/(1−L).
- **Recycling is circular** — what you can pay off the home loan depends on the
  refund, the refund depends on how much deductible debt you drew, and that is
  the amount itself. A fixed point settles it, and a test asserts the year's
  cash balances to the cent in every mode.
- **A year that cannot pay its own interest sells units**, realising a gain and
  shrinking the position. Last year's capital gains tax is paid out of this
  year's cash, as it is in life.

## Tests

The engine is pure — no DOM, no globals — and sits between `engine:start` and
`engine:end` markers so it can be pulled out of the page and run in node:

```sh
node test.js index.html
```

100 assertions covering the tax scale against hand-worked figures, the
surcharge add-back, both ledgers agreeing when gearing is zero, the debt
invariants of recycling, margin calls and wipe-outs, the monotonicity the
break-even bisection depends on, Monte Carlo determinism and band ordering, the
annual cash identity in all three modes, and a sweep asserting every scenario
the sliders can reach produces finite, non-negative balances.

## Also

- Every setting lives in the URL hash, so a copied link reproduces the exact
  scenario. State also persists in `localStorage`.
- Dark and light themes, set before first paint so there is no flash.
- CSV export carries the inputs, the result, the risk figures and every year.
- Prints on a light ground with the charts rebuilt for paper.
- Charts are keyboard navigable (arrows, Home/End, shift for a bigger step) and
  described for screen readers. On touch a readout stays put until you tap
  somewhere else, rather than vanishing when your finger lifts.
- Up and down nudge any number field by exactly what its own slider moves, with
  shift for ten of those, so the thumb and the number can never drift apart — a
  range input snaps whatever you assign it onto its step grid, and a half-notch
  nudge would leave the thumb pointing at a figure the field isn't showing. The
  eight fields with no slider fall back to $500, a year, or 0.1 of a point. The
  step lands on a multiple of itself, so 96,300 goes to 100,000 rather than
  101,300.

## Not advice

Educational tool only. Gearing magnifies losses as well as gains, and interest
is deductible only where the borrowed money is genuinely used to produce
assessable income — decided by the use of the funds, not by the security behind
the loan. Mixing purposes in one account creates a mixed-purpose loan whose
repayments are apportioned. Getting any of this wrong is expensive. See the full
disclaimer in the page, and speak to a registered tax agent before acting.

## Sibling tools

- [FIRE calculator](https://raghu-nayak.github.io/au-fire-calculator/) — can you
  retire, and what breaks first
- [Investment growth calculator](https://raghu-nayak.github.io/investment-calc/) —
  what contributions, returns, fees, tax and inflation do over time

## Licence

