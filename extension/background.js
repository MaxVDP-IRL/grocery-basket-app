// background.js — service worker
// Multi-store grocery basket filler: Barbora + Rimi + Selver

const DELAY_MS = 400; // ms between cart adds — avoids hammering APIs

// ── Rimi HTML parser (no DOMParser — not reliable in MV3 service workers) ─────

function parseRimiHtml(html, limit) {
  const products = [];
  let searchFrom = 0;

  while (products.length < limit) {
    // Find the next product container marker
    const markerIdx = html.indexOf('js-product-container', searchFrom);
    if (markerIdx === -1) break;

    // Walk back to find the opening '<' of this tag
    let tagStart = markerIdx;
    while (tagStart > 0 && html[tagStart] !== '<') tagStart--;

    // Walk forward to find the closing '>' of the opening tag,
    // respecting single- and double-quoted attribute values
    let tagEnd = tagStart;
    let inSingle = false, inDouble = false;
    while (tagEnd < html.length) {
      const ch = html[tagEnd];
      if      (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === '>' && !inSingle && !inDouble) break;
      tagEnd++;
    }

    const tag = html.slice(tagStart, tagEnd + 1);
    searchFrom = tagEnd + 1;

    // Extract data-product-code (always double-quoted numeric value)
    const codeMatch = tag.match(/data-product-code="(\d+)"/);
    if (!codeMatch) continue;
    const code = codeMatch[1];

    // Extract data-gtm-eec-product — Rimi uses single-quotes around this
    // attribute because the JSON value contains double-quotes
    const gtmMatch = tag.match(/data-gtm-eec-product='([^']*)'/);
    if (!gtmMatch) continue;

    let gtm;
    try {
      const raw = gtmMatch[1];
      // Attribute is sometimes truncated — close defensively
      gtm = JSON.parse(raw.endsWith('}') ? raw : raw + '"}');
    } catch {
      continue;
    }

    if (gtm.price == null) continue;

    const image = `https://rimibaltic-res.cloudinary.com/image/upload/b_white,c_limit,dpr_auto,f_auto,h_216,q_1,w_216/d_ecommerce:backend-fallback.png/MAT_${code}_PCE_EE`;

    products.push({
      sku:   code,
      title: gtm.name || '',
      price: parseFloat(gtm.price),
      image,
      store: 'rimi',
    });
  }

  return products;
}

// ── Barbora Adapter ───────────────────────────────────────────────────────────

const BarboraAdapter = {
  BASE: 'https://barbora.ee',

  async getHeaders() {
    const sessionCookie = await chrome.cookies.get({ url: this.BASE, name: 'X-Session-ID' });
    const { clientVersion } = await chrome.storage.local.get('clientVersion');
    return {
      'Content-type':  'application/json',
      'ClientVersion': clientVersion || 'v2.67.18',
      'X-Session-ID':  sessionCookie?.value || '',
    };
  },

  async checkSession() {
    try {
      const res = await fetch(`${this.BASE}/proxy/api/v1/user/info`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async search(query, limit = 8) {
    const headers = await this.getHeaders();
    const params  = new URLSearchParams({ 'request.searchText': query, 'request.limit': limit });
    const res = await fetch(`${this.BASE}/api/eshop/v1/constructor/autocomplete?${params}`, {
      headers, credentials: 'include',
    });
    if (!res.ok) throw new Error(`Barbora search failed: ${res.status}`);
    const data = await res.json();
    return (data.products || []).map(p => ({
      sku:   p.id,
      title: p.title,
      price: p.price,
      image: p.image,
      store: 'barbora',
    }));
  },

  async getCart() {
    try {
      const headers = await this.getHeaders();
      const res = await fetch(`${this.BASE}/api/eshop/v1/cart`, { headers, credentials: 'include' });
      if (!res.ok) return new Set();
      const data  = await res.json();
      const items = data?.cart?.items || data?.items || [];
      return new Set(items.map(i => String(i.product_id || i.id || '')).filter(Boolean));
    } catch {
      return new Set();
    }
  },

  async addItem(sku, quantity) {
    const headers = await this.getHeaders();
    const res = await fetch(`${this.BASE}/api/eshop/v1/cart/item?returnCartInfo=true`, {
      method:      'POST',
      headers,
      credentials: 'include',
      body:        JSON.stringify({ product_id: sku, quantity, unit: 0, web_url: this.BASE }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    return res.json();
  },
};

// ── Rimi Adapter ──────────────────────────────────────────────────────────────

const RimiAdapter = {
  BASE:   'https://www.rimi.ee',
  LOCALE: 'ee',

  async getHeaders() {
    const { rimiCsrfToken } = await chrome.storage.local.get('rimiCsrfToken');
    return {
      'X-CSRF-TOKEN':     rimiCsrfToken || '',
      'X-Requested-With': 'XMLHttpRequest',
    };
  },

  async checkSession() {
    try {
      const res = await fetch(
        `${this.BASE}/epood/api/v1/users/current/greeting?locale=${this.LOCALE}`,
        { credentials: 'include' }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.userName) return null;
      return { name: data.userName };
    } catch {
      return null;
    }
  },

  async search(query, limit = 8) {
    // Rimi search is server-side rendered HTML — fetch and parse with regex
    // (DOMParser is not reliably available in MV3 service workers)
    const url = `${this.BASE}/epood/${this.LOCALE}/otsing?query=${encodeURIComponent(query)}:relevance`;
    const res = await fetch(url, { credentials: 'include' });

    if (res.status === 404) {
      throw new Error('Rimi: no active delivery reservation. Please select a delivery slot on rimi.ee/epood first.');
    }
    if (!res.ok) throw new Error(`Rimi search failed: HTTP ${res.status}`);

    const html = await res.text();
    return parseRimiHtml(html, limit);
  },

  async getCart() {
    // Rimi cart state is HTML-rendered — skip dedup for now
    return new Set();
  },

  async addItem(sku, quantity) {
    const headers = await this.getHeaders();
    if (!headers['X-CSRF-TOKEN']) {
      throw new Error('Rimi CSRF token missing — please visit rimi.ee/epood first to activate the extension.');
    }
    const body = new URLSearchParams({
      _method: 'put',
      product: String(sku),
      amount:  String(quantity),
    });
    const res = await fetch(`${this.BASE}/epood/cart/change`, {
      method:      'POST',
      headers:     { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body:        body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    return res.text();
  },
};

// ── Selver Adapter ────────────────────────────────────────────────────────────

const SelverAdapter = {
  BASE:     'https://www.selver.ee',
  CATALOG:  'https://www.selver.ee/api/catalog/vue_storefront_catalog_et',
  CART_API: 'https://www.selver.ee/api/cart',

  cartUrl(action, token) {
    return `${this.CART_API}/${action}?token=${token}&cartId=${token}`;
  },

  async getOrCreateToken() {
    const { selverCartToken } = await chrome.storage.local.get('selverCartToken');
    if (selverCartToken) return selverCartToken;

    // Create a new guest cart — no login required
    const res = await fetch(`${this.CART_API}/create`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (data.code === 200 && data.result) {
      await chrome.storage.local.set({ selverCartToken: data.result });
      return data.result;
    }
    throw new Error('Selver: failed to create guest cart');
  },

  async checkSession() {
    // Selver uses guest carts — no login needed to search or add items.
    // Just verify we can reach the API and get/create a token.
    try {
      await this.getOrCreateToken();
      return { name: 'Guest cart' };
    } catch {
      return null;
    }
  },

  async search(query, limit = 8) {
    const url = `${this.CATALOG}/product/_search?q=${encodeURIComponent(query)}&size=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Selver search failed: ${res.status}`);
    const data = await res.json();

    return (data.hits?.hits ?? []).map(h => {
      const p = h._source;
      const price = p.final_price_incl_tax ?? p.price_incl_tax ?? 0;
      const image = p.image
        ? `${this.BASE}/media/catalog/product${p.image}`
        : '';
      return {
        sku:   String(p.sku),
        title: p.name || '',
        price,
        image,
        store: 'selver',
      };
    });
  },

  async getCart() {
    try {
      const token = await this.getOrCreateToken();
      const res   = await fetch(this.cartUrl('pull', token));
      if (!res.ok) return new Set();
      const data = await res.json();
      if (data.code === 200 && Array.isArray(data.result)) {
        return new Set(data.result.map(i => String(i.sku)));
      }
      return new Set();
    } catch {
      return new Set();
    }
  },

  async addItem(sku, quantity) {
    const token = await this.getOrCreateToken();

    const attempt = async () => {
      const res = await fetch(this.cartUrl('update', token), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cartItem: { sku: String(sku), qty: quantity, quoteId: token } }),
      });
      const data = await res.json();
      if (data.code === 200) return true;
      // Server error messages are in Estonian — pass them through verbatim
      const msg = typeof data.result === 'string' ? data.result : `HTTP ${data.code}`;
      throw new Error(msg);
    };

    const verify = async () => {
      const items = await this.getCart();
      return items.has(String(sku));
    };

    // Selver has a cart race condition: server returns 200 but silently fails to persist.
    // Verify by reading back; retry once if missing.
    await attempt();
    if (await verify()) return;
    await attempt();
    if (await verify()) return;
    throw new Error('Selver: item accepted but not persisted — possible cart race condition. Try again.');
  },
};

// ── Store selection ───────────────────────────────────────────────────────────

async function getAdapter() {
  const { selectedStore } = await chrome.storage.local.get('selectedStore');
  if (selectedStore === 'rimi')   return RimiAdapter;
  if (selectedStore === 'selver') return SelverAdapter;
  return BarboraAdapter;
}

// ── Shared basket fill ────────────────────────────────────────────────────────

async function fillBasket(items, alreadyInCart = new Set()) {
  const adapter = await getAdapter();
  const results = [];
  let i = 0;

  for (const { sku, title, quantity } of items) {
    if (alreadyInCart.has(String(sku))) {
      results.push({ sku, title, ok: true, skipped: true });
    } else {
      try {
        await adapter.addItem(sku, quantity);
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

// ── Price comparison ──────────────────────────────────────────────────────────

async function comparePrices(items) {
  const results = [];

  for (const item of items) {
    // Use first 3 words of the title for cross-store matching
    const query = item.title.split(/\s+/).slice(0, 3).join(' ');

    const [barboraRes, rimiRes, selverRes] = await Promise.allSettled([
      BarboraAdapter.search(query, 5),
      RimiAdapter.search(query, 5),
      SelverAdapter.search(query, 5),
    ]);

    results.push({
      originalItem: item,
      barbora:     barboraRes.status === 'fulfilled' ? (barboraRes.value[0] || null) : null,
      rimi:        rimiRes.status === 'fulfilled'    ? (rimiRes.value[0] || null)    : null,
      selver:      selverRes.status === 'fulfilled'  ? (selverRes.value[0] || null)  : null,
      rimiError:   rimiRes.status === 'rejected'     ? rimiRes.reason?.message       : null,
      selverError: selverRes.status === 'rejected'   ? selverRes.reason?.message     : null,
    });

    await new Promise(r => setTimeout(r, 200)); // gentle pacing between items
  }

  return results;
}

// ── Refresh prices ────────────────────────────────────────────────────────────

async function refreshPrices(ingredientMap, adapterOverride) {
  const adapter = adapterOverride || await getAdapter();
  const updated = { ...ingredientMap };
  let refreshed = 0;

  for (const [name, mapped] of Object.entries(ingredientMap)) {
    try {
      const query   = mapped.title.split(/\s+/).slice(0, 3).join(' ');
      const results = await adapter.search(query, 15);
      const match   = results.find(r => r.sku === mapped.sku);
      if (match && match.price != null) {
        updated[name] = { ...mapped, price: match.price };
        refreshed++;
      }
      await new Promise(r => setTimeout(r, 150));
    } catch {
      // keep old price for this ingredient
    }
  }

  return {
    ingredientMap: updated,
    updatedAt:     new Date().toISOString(),
    refreshed,
  };
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'CHECK_SESSION') {
    getAdapter().then(a => a.checkSession()).then(user => sendResponse({ user }));
    return true;
  }

  if (msg.type === 'SEARCH') {
    // msg.store optionally overrides the selected store (used by resolver page)
    const adapterPromise = msg.store === 'barbora' ? Promise.resolve(BarboraAdapter)
                         : msg.store === 'rimi'    ? Promise.resolve(RimiAdapter)
                         : msg.store === 'selver'  ? Promise.resolve(SelverAdapter)
                         : getAdapter();
    adapterPromise
      .then(a => a.search(msg.query, msg.limit))
      .then(results => sendResponse({ results }))
      .catch(e      => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'FILL_BASKET') {
    (async () => {
      try {
        const adapter  = await getAdapter();
        const cartSkus = await adapter.getCart();
        const results  = await fillBasket(msg.items, cartSkus);

        // Selver: inject cart token into the page and open the cart.
        // The content script handles Vue store replay on the cart page.
        const { selectedStore } = await chrome.storage.local.get('selectedStore');
        if (selectedStore === 'selver') {
          const { selverCartToken } = await chrome.storage.local.get('selverCartToken');
          if (selverCartToken) {
            await chrome.storage.local.set({ selverPendingCartToken: selverCartToken });
            chrome.tabs.create({ url: 'https://www.selver.ee/cart' });
          }
        }

        sendResponse({ results, skipped: results.filter(r => r.skipped).length });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'COMPARE_PRICES') {
    comparePrices(msg.items)
      .then(results => sendResponse({ results }))
      .catch(e      => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'SET_STORE') {
    chrome.storage.local.set({ selectedStore: msg.store })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'REFRESH_PRICES') {
    const adapter = msg.store === 'barbora' ? BarboraAdapter
                  : msg.store === 'rimi'    ? RimiAdapter
                  : msg.store === 'selver'  ? SelverAdapter
                  : null; // null = use currently selected store
    refreshPrices(msg.ingredientMap, adapter)
      .then(result => sendResponse(result))
      .catch(e     => sendResponse({ error: e.message }));
    return true;
  }

});
