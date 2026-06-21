# spec.md — Epic → ITAD collection backup

## Purpose
A standalone, no-build, no-login web tool that converts an Epic Games **order
history** export into an IsThereAnyDeal (ITAD) **collection backup file**
(`collection.backup.json`) that the user imports manually on ITAD. It resolves
every game to its real ITAD game id client-side via ITAD's public lookup
endpoints (no API key, no OAuth, no server).

Replaces the OAuth + Cloudflare-Worker sync flow of the original
`Kalcode/isthereyanydeals-epic-json-importer`.

## Files
- `index.html` — the whole app (UI + parser + ITAD lookup pipeline + console script). Self-contained.
- `epic-order-export.js` — standalone copy of the DevTools console harvester (also embedded in `index.html`).
- `spec.md` — this file.
- `decisions.md` — design notes (why the tool works the way it does).

## Input
Epic order history JSON from
`accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory`:
```
{ "orders": [ { "orderId", "createdAtMillis",
                "items": [ { "description", "offerId", ... } ] } ],
  "nextPageToken": "<ISO timestamp | null>" }
```
Also accepts a bare array of orders, or a single order object.

## Output
ITAD collection backup, schema `version "03"`, with three groups:
```
{ "version": "03",
  "data": [ { "group": "epiclibrary_desktop", "public": false,
              "games": [ { "id": "<ITAD game UUID>", "title": "<label>",
                           "platforms": 0, "playtime": 0 } ] },
            { "group": "epiclibrary_android", "public": false, "games": [] },
            { "group": "epiclibrary_ios",     "public": false, "games": [] } ] }
```
All matched games go into `epiclibrary_desktop`; `_android` and `_ios` are empty.
The user moves mobile titles into them on ITAD (the order JSON carries no platform
info — see decisions.md, "Three platform groups").
CRITICAL: `id` must be ITAD's own game id (a UUIDv7, e.g.
`018d937f-62de-7349-9bf3-ab4f9f414d47`), NOT the Epic offer id. The backup is a
restore format keyed on ITAD ids; titles are display labels only. (See decisions.md,
"The backup id must be an ITAD game id".)

## Resolution pipeline (client-side, keyless)
1. Parse orders → unique `{offerId, title}` (dedupe by offerId).
2. `POST https://api.isthereanydeal.com/lookup/id/shop/16/v1` with the offer-id
   array (shop 16 = Epic) → `{offerId: itadId|null}`. Exact, but order-history
   offer ids miss often.
3. For nulls, `POST .../lookup/id/title/v1` with their titles → `{title: itadId|null}`.
4. `itadId = shopResult || titleResult`. Dedupe games by ITAD id.
5. Unmatched (both null) are listed in the UI and left out of the file.

Both endpoints currently respond **without an API key** and send
`access-control-allow-origin: *`. Their CORS preflight, however, omits
`access-control-allow-headers`, so the POSTs must stay "simple" to avoid a
preflight: they send `Content-Type: text/plain` (a CORS-safelisted value), not
`application/json`. ITAD parses the JSON body regardless of the declared
content-type. (See decisions.md, "CORS".) An optional API-key field appends `?key=` as a
fallback if keyless access is ever blocked. Requests are chunked at 1000 ids
(most libraries are one or two calls per lookup).

## Get-your-data flow (Step 0)
Epic paginates 10 orders per page via `nextPageToken`. The embedded console
script (run signed-in on `epicgames.com/account/transactions`) walks every page
with `credentials: "include"`, consolidates to one `{ "orders": [...] }`, copies
to clipboard, and downloads `epic-orders.json`. Nothing leaves the machine.

## Re-import note
Delete any earlier broken `epicmanualimport` group on ITAD first. ITAD's
importer is game-centric and may skip the two empty groups; if so, create
`epiclibrary_android` / `epiclibrary_ios` in the ITAD UI once and move games across.

## Non-goals
OAuth/login; direct sync to ITAD; embedding a shared API key.

## Verified
- Tested end-to-end on a real Epic library: most games resolve via the shop
  lookup, the rest via the title fallback; a few edition/bundle name variants
  resolve by neither and are reported as unmatched. All output ids are valid
  UUIDv7.
- In-page pipeline byte-parity with the standalone tested pipeline.
- Console loop terminates on null token, repeated token, and empty page (mock fetch).
