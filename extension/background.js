// background.js — service worker
// Handles all API calls to barbora.ee. Runs independently of any tab.

const BASE     = 'https://barbora.ee';
const DELAY_MS = 400; // between cart adds — avoids hammering the API

async function getHeaders() {
  const sessionCookie = await chrome.cookies.get({ url: BASE, name: 'X-Session-ID' });
  const { clientVersion } = await chrome.storage.local.get('clientVersion');
  return {
    'Content-type':  'application/json',
    'ClientVersion': clientVersion || 'v2.67.18',
    'X-Session-ID':  sessionCookie?.value || '',
  };
}

async function checkSession() {
  try {
    const res = await fetch(`${BASE}/proxy/api/v1/user/info`, { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function search(query, limit = 8) {
  const headers = await getHeaders();
  const params  = new URLSearchParams({ 'request.searchText': query, 'request.limit': limit });
  const res = await fetch(`${BASE}/api/eshop/v1/constructor/autocomplete?${params}`, {
    headers, credentials: 'include',
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return (data.products || []).map(p => ({
    sku:   p.id,
    title: p.title,
    price: p.price,
    image: p.image,
  }));
}

async function getCart() {
  // Returns the set of SKUs currently in the Barbora cart.
  // Fails gracefully — if the endpoint changes or the user isn't logged in, returns empty.
  try {
    const headers = await getHeaders();
    const res = await fetch(`${BASE}/api/eshop/v1/cart`, { headers, credentials: 'include' });
    if (!res.ok) return new Set();
    const data  = await res.json();
    const items = data?.cart?.items || data?.items || [];
    return new Set(items.map(i => String(i.product_id || i.id || '')).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function addItem(sku, quantity) {
  const headers = await getHeaders();
  const res = await fetch(`${BASE}/api/eshop/v1/cart/item?returnCartInfo=true`, {
    method:      'POST',
    headers,
    credentials: 'include',
    body:        JSON.stringify({ product_id: sku, quantity, unit: 0, web_url: BASE }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

async function fillBasket(items, alreadyInCart = new Set()) {
  const results = [];
  let i = 0;

  for (const { sku, title, quantity } of items) {
    if (alreadyInCart.has(String(sku))) {
      results.push({ sku, title, ok: true, skipped: true });
    } else {
      try {
        await addItem(sku, quantity);
        results.push({ sku, title, ok: true });
      } catch (e) {
        results.push({ sku, title, ok: false, error: e.message });
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    i++;
    chrome.runtime.sendMessage({
      type:    'FILL_PROGRESS',
      current: i,
      total:   items.length,
      results: [...results],
    }).catch(() => {}); // popup may be closed — ignore
  }

  return results;
}

async function refreshPrices(ingredientMap) {
  // Re-fetch current prices from Barbora by searching each ingredient's stored title.
  // Matches by SKU among search results — skips if no match found.
  const updated = { ...ingredientMap };
  let refreshed = 0;

  for (const [name, mapped] of Object.entries(ingredientMap)) {
    try {
      // Use first 3 words of product title as search query for reliability
      const query   = mapped.title.split(/\s+/).slice(0, 3).join(' ');
      const results = await search(query, 15);
      const match   = results.find(r => r.sku === mapped.sku);
      if (match && match.price != null) {
        updated[name] = { ...mapped, price: match.price };
        refreshed++;
      }
      await new Promise(r => setTimeout(r, 150)); // gentle pacing
    } catch {
      // Keep old price for this ingredient
    }
  }

  return {
    ingredientMap: updated,
    updatedAt:     new Date().toISOString(),
    refreshed,
  };
}

// ── Message router ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'CHECK_SESSION') {
    checkSession().then(user => sendResponse({ user }));
    return true;
  }

  if (msg.type === 'SEARCH') {
    search(msg.query, msg.limit)
      .then(results => sendResponse({ results }))
      .catch(e    => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'FILL_BASKET') {
    (async () => {
      try {
        // Check what's already in the cart, then skip those items
        const cartSkus = await getCart();
        const results  = await fillBasket(msg.items, cartSkus);
        const skipped  = results.filter(r => r.skipped).length;
        sendResponse({ results, skipped });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'REFRESH_PRICES') {
    refreshPrices(msg.ingredientMap)
      .then(result  => sendResponse(result))
      .catch(e      => sendResponse({ error: e.message }));
    return true;
  }

});
