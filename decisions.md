# Design notes

Why this tool works the way it does. Read alongside `spec.md` (what it does).

## Manual import file, not OAuth sync
- The original project synced to ITAD over OAuth via a hosted Cloudflare Worker.
- ITAD also accepts a hand-uploaded `collection.backup.json` from its collection
  import page. Producing that file lets us drop the OAuth flow *and* the server.
- Result: no login, no backend, no secrets — a static page you can self-host or
  open from `file://`. The only cost is one manual "import" click on ITAD.

## The backup `id` must be an ITAD game id, not the Epic offer id
- `version "03"` is a *restore* format. Each game row is keyed on ITAD's own
  internal game id (a UUIDv7), not on a title or a store's id.
- Putting the Epic `offerId` in `id` *looks* like it works — ITAD's importer
  reports the rows as "added" — but the collection comes up empty, because those
  ids resolve to no real game.
- So every game has to be resolved to its ITAD id **before** export. This is the
  entire reason the tool makes network calls.
- The `title` on each row is just a display label; ITAD does not match on it.

## Resolving games: two keyless lookups
- ITAD exposes public id-lookup endpoints that map external identifiers to ITAD
  ids. The tool uses two, in order:
  - `POST /lookup/id/shop/16/v1` — Epic store (shop 16) offer ids → ITAD ids.
    Exact, but *order-history* offer ids are often old or regional variants ITAD
    doesn't have on file, so a chunk of them come back `null`.
  - `POST /lookup/id/title/v1` — titles → ITAD ids. Run only on the titles the
    shop lookup missed, as a fallback.
- Final id for a game = shop result, else title result, else unmatched.
- **Dedupe the final list by ITAD id.** Two offer ids (or a title variant) can
  point at the same game, and one game can appear under several offer ids.
- Requests are chunked (1000 ids per POST) so even large libraries are one or two
  calls per lookup.

## Keyless by default, optional API key
- Both lookup endpoints answer without an API key today, so the tool needs zero
  setup.
- An optional key field is provided; if filled it's appended as `?key=…`. It's a
  fallback for if keyless access is ever rate-limited or withdrawn — not required.

## CORS: send `text/plain`, not `application/json`
- The lookups are cross-origin POSTs from your page to `api.isthereanydeal.com`.
- `Content-Type: application/json` makes the request "non-simple", so the browser
  fires a CORS preflight `OPTIONS` first.
- ITAD's preflight allows the origin and the POST method but does **not** list
  `content-type` in `access-control-allow-headers` — so the browser blocks the
  real request (`content-type not allowed`).
- Fix: send `Content-Type: text/plain`, a CORS-safelisted value. The request stays
  "simple", no preflight is sent, and the plain POST is allowed
  (`access-control-allow-origin: *`).
- Safe because ITAD parses the body as JSON regardless of the declared
  content-type (verified: identical responses for `application/json` and
  `text/plain`).

## Three platform groups, but Android/iOS left empty
- The backup can hold multiple collection groups. The tool emits three:
  `epiclibrary_desktop`, `epiclibrary_android`, `epiclibrary_ios`.
- All matched games go into `epiclibrary_desktop`; the two mobile groups ship
  empty.
- Why not auto-sort by platform: the Epic order JSON has **no platform field** —
  only description, amounts, currency, offerId, namespace. Which platform you
  *bought* on is simply not in the data. (ITAD can tell you a game's *supported*
  platforms with a key, but not your purchase platform, and cross-platform titles
  are ambiguous anyway.)
- So the tool doesn't guess — it leaves the mobile groups empty and you move any
  mobile titles into them yourself on ITAD.
- Caveat: ITAD's importer may skip empty groups. If the mobile groups don't show
  up after import, create them once in the ITAD UI and move games across.

## Getting the Epic data: an in-page console script
- Epic's order-history endpoint paginates 10 orders per page via a
  `nextPageToken`.
- The bundled script (`epic-order-export.js`, also embedded in the page) runs in
  DevTools while you're signed in to Epic. It walks every page with
  `credentials: "include"`, merges them into one `{ "orders": [...] }`, copies it
  to the clipboard and downloads it.
- It runs on Epic's own site against your own session, so the data never leaves
  your machine — there's no server in this tool to send it to.
- The page loop is guarded against the usual pagination traps: null token,
  repeated token, empty page, and a hard page cap.

## One file, vanilla JS, no build
- Everything — UI, parser, lookup pipeline, console script — is a single
  `index.html` with no dependencies and no build step.
- The parser is a loop plus a Set; the pipeline is two POSTs and a Map.
- Open it from `file://` or drop the static file on any host.

## Known limitations
- A few titles resolve by neither offer id nor exact title (usually bundle or
  edition name variants). They're listed in the UI and left out of the file. A
  manual search step (`/games/search/v1`, which needs a key) could let you pick
  the right game — not built yet.
- `playtime` and `platforms` are written as `0`; the order data carries neither.
