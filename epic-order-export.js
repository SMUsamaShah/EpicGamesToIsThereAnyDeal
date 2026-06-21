/*
 * Epic order-history exporter
 * --------------------------------------------------------------------------
 * Run this in your browser's DevTools console while signed in to Epic, on:
 *     https://www.epicgames.com/account/transactions
 *
 * It walks every page of your order history via nextPageToken, consolidates
 * them into one { "orders": [...] } object, copies it to your clipboard, and
 * downloads it as epic-orders.json. Feed that file into the ITAD importer.
 *
 * No data leaves your machine; requests go only to Epic with your own session.
 */
(async () => {
  const BASE = "https://accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory";
  const COUNT = 10;          // proven page size from the real endpoint
  const DELAY_MS = 350;      // be polite between requests
  const MAX_PAGES = 1000;    // hard safety cap

  const params = new URLSearchParams({
    count: String(COUNT),
    sortDir: "DESC",
    sortBy: "DATE",
    locale: "en-US",
  });

  const seen = new Set();
  const allOrders = [];
  let token = null;
  let prevToken = "__none__";
  let page = 0;

  console.log("%cEpic order export started…", "color:#e0a23c;font-weight:bold");

  while (page < MAX_PAGES) {
    if (token) params.set("nextPageToken", token);
    else params.delete("nextPageToken");

    let res;
    try {
      res = await fetch(`${BASE}?${params.toString()}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      console.error("Network error — are you signed in on this page?", err);
      break;
    }

    if (!res.ok) {
      console.error(`Request failed (${res.status}). Stopping.`, await res.text().catch(() => ""));
      break;
    }

    const data = await res.json();
    const orders = Array.isArray(data.orders) ? data.orders : [];

    let added = 0;
    for (const o of orders) {
      const id = o && o.orderId;
      if (id && !seen.has(id)) { seen.add(id); allOrders.push(o); added++; }
    }

    page++;
    console.log(`Page ${page}: +${added} new (total ${allOrders.length})`);

    token = data.nextPageToken || null;
    if (!token || added === 0 || token === prevToken) break;  // termination guards
    prevToken = token;

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const result = { orders: allOrders };
  const text = JSON.stringify(result, null, 2);

  window.__epicOrders = result;  // also left on window for manual access
  console.log(`%cDone: ${allOrders.length} orders across ${page} page(s).`,
    "color:#7ec47e;font-weight:bold");

  try {
    await navigator.clipboard.writeText(text);
    console.log("Copied JSON to clipboard.");
  } catch {
    console.log("Clipboard blocked — using download + window.__epicOrders instead.");
  }

  try {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "epic-orders.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.warn("Download failed; copy window.__epicOrders manually.", err);
  }
})();
