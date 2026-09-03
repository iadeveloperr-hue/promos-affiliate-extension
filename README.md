# Promos — Chrome Extension (Manifest V3)

A production Chrome extension that turns a product page on **Amazon BR, Mercado
Livre or Shopee** into a ready-to-send WhatsApp offer post: it scrapes the
product data from the live DOM, builds the affiliate link with the right
tracking for the chosen audience, and renders an editable post in an injected
overlay.

Built for and used daily by a real affiliate-marketing operation. This is a
sanitised public copy — group invites, tracking IDs and affiliate account IDs
are replaced with placeholders.

## The interesting problems

### 1. Three marketplaces, three different extraction strategies

Each site is a separate parser behind a common adapter interface
(`parsers/index.js` picks one by hostname). Every parser walks the same
degradation ladder:

```
JSON-LD  →  embedded page state  →  CSS selector  →  report "couldn't extract X"
```

The last rung matters most. When a field can't be read the overlay says so and
leaves the input blank, rather than guessing. Posting a wrong price to a
audience of buyers is worse than posting nothing.

### 2. Affiliate links can't be faked, so each site gets its own mechanism

| Marketplace | How the link is produced | Why |
|---|---|---|
| Amazon | SiteStripe short link, with a `?tag=` long-link fallback | Short links are generated server-side; the fallback keeps the commission if SiteStripe is slow |
| Mercado Livre | Clicks the affiliate bar's own Share button and reads the resulting `meli.la` via `MutationObserver` + timeout | The commission is bound to the generated link; re-shortening it through a third party silently voids it |
| Shopee | Official panel/API short link, `sub_id` per audience | Heavy JS and anti-bot make DOM scraping unreliable |

### 3. Wrong-account protection

The operation runs several audiences from different browser profiles, each with
its own affiliate account. Generating a Mercado Livre link while logged into
the wrong account produces a link that looks correct and pays the wrong person —
a failure that is invisible until the monthly report.

`content/accountGuard.js` reads the logged-in account from the page and refuses
to build the link when it doesn't match the audience selected in the context
menu. Silent-but-wrong is treated as the worst possible outcome, so the
extension is designed to fail loudly instead.

### 4. Clipboard image handoff

WhatsApp's link preview frequently fails to load (consistently so for Mercado
Livre). The overlay therefore always offers the product image via
`navigator.clipboard.write()`, converting JPEG/WebP to PNG through a canvas
first, because the clipboard API only accepts PNG.

## Architecture

```
manifest.json              MV3, minimum permissions
background/
  service-worker.js        context menu, dispatch to the content script
content/
  content.js               site detection, orchestration
  overlay.js / .css        injected editable overlay (every field editable)
  accountGuard.js          wrong-affiliate-account lock
  garimpo.js, queue.js     bulk collection and queue
parsers/
  index.js                 hostname → parser
  amazon.js  mercadolivre.js  shopee.js
lib/
  config.js                single source of truth: links, tracking IDs, sub_ids
  affiliate.js             per-site link building
  template.js              post assembly (price formatting, line breaks, coupons)
  scoring.js, radarEngine.js, demandProfile.js
```

Design rule that shaped the codebase: **`lib/config.js` is the only file that
knows a real link or tracking ID.** Every other module receives them by
audience ID. A hard-coded link anywhere else is a bug, because the failure it
causes — an offer posted with another audience's invite — is not visible in
testing.

Why an injected overlay instead of the popup: under MV3 a popup cannot be
opened reliably from a context-menu handler, so the UI is injected into the
page instead.

## Stack

JavaScript (ES modules) · Chrome Extension MV3 · DOM scraping · Canvas ·
Clipboard API · `chrome.storage`

## Run it

```
chrome://extensions → Developer mode → Load unpacked → this folder
```

Then fill in your own values in `lib/config.js` and `content/globals.js` (the
runtime mirrors the config; both must agree). Right-click a product page on any
supported marketplace.

## Note on this copy

Group invite links, Amazon tracking IDs, Shopee `sub_id`s and Mercado Livre
account IDs have been replaced with placeholders. Published as a fresh
repository rather than as a history rewrite, so no real identifier is
recoverable from earlier commits.
