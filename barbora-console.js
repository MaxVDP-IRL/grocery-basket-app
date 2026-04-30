/**
 * barbora-console.js — Step 1 (browser version)
 *
 * Paste this into the Chrome DevTools console while on barbora.ee.
 * No cookie setup needed — the browser handles auth automatically.
 *
 * To find SKUs: set searchMode = true and run.
 * To fill basket: set searchMode = false and edit ITEMS.
 */

(async () => {

  const SEARCH_MODE  = false;
  const SEARCH_QUERY = 'piim';
  const SEARCH_LIMIT = 8;

  const ITEMS = [
    { sku: '000000000000139701', quantity: 2 },  // Alma piim 3.5% 1.5L
    // { sku: 'ANOTHER_SKU', quantity: 1 },
  ];

  const DELAY = 400; // ms between requests

  // ── Auth headers (read live from the page) ──────────────────────────────
  const sessionId     = document.cookie.match(/X-Session-ID=([^;]+)/)?.[1];
  const clientVersion = window.ENV?.appVersion ?? 'v2.67.18';

  if (!sessionId) {
    console.error('❌ Not logged in — no X-Session-ID cookie found. Log into barbora.ee first.');
    return;
  }

  const headers = {
    'Content-type':  'application/json',
    'ClientVersion': clientVersion,
    'X-Session-ID':  sessionId,
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Search ───────────────────────────────────────────────────────────────
  async function search(query, limit) {
    const params = new URLSearchParams({ 'request.searchText': query, 'request.limit': limit });
    const res = await fetch(`/api/eshop/v1/constructor/autocomplete?${params}`, { headers });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    const data = await res.json();
    console.log(`\nResults for "${query}":`);
    (data.products || []).forEach(p =>
      console.log(`  ${p.id}  €${p.price?.toFixed(2).padStart(5)}  ${p.title}`)
    );
  }

  // ── Add item ─────────────────────────────────────────────────────────────
  async function addItem(sku, quantity) {
    const res = await fetch('/api/eshop/v1/cart/item?returnCartInfo=true', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ product_id: sku, quantity, unit: 0, web_url: location.href }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${res.status}: ${txt.slice(0, 150)}`);
    }
    const data = await res.json();
    const products = data?.cart?.slices?.[0]?.products ?? [];
    return products.length;
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  console.log(`Session ID: ${sessionId.slice(0,8)}...  ClientVersion: ${clientVersion}`);

  if (SEARCH_MODE) {
    await search(SEARCH_QUERY, SEARCH_LIMIT);
    return;
  }

  // Verify session
  const userRes = await fetch('/proxy/api/v1/user/info');
  if (!userRes.ok) { console.error('❌ Session invalid.'); return; }
  const user = await userRes.json();
  console.log(`✓ Logged in as ${user.name} ${user.surname}`);

  let ok = 0;
  for (const { sku, quantity } of ITEMS) {
    try {
      const cartSize = await addItem(sku, quantity);
      console.log(`✓ Added ${quantity}× ${sku}  (cart: ${cartSize} line(s))`);
      ok++;
    } catch (e) {
      console.error(`❌ ${sku}: ${e.message}`);
    }
    await sleep(DELAY);
  }

  console.log(`\n${ok}/${ITEMS.length} items added. Refresh barbora.ee/cart to confirm.`);

})();
