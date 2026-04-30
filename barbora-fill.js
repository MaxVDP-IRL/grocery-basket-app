/**
 * barbora-fill.js — Step 1: Standalone basket fill script
 *
 * Setup:
 *   1. Open barbora.ee in Chrome, log in
 *   2. F12 → Application → Cookies → https://barbora.ee
 *   3. Copy X-Session-ID and AWSALB values into CONFIG below
 *   4. Edit the ITEMS array with what you want to add
 *   5. node barbora-fill.js
 *
 * Finding SKUs:
 *   Run with SEARCH_MODE = true and set SEARCH_QUERY to find product IDs.
 *   Or look in the URL when you click a product on barbora.ee —
 *   the product ID appears in network requests as "id=000000000000XXXXXX"
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────

const CONFIG = {
  sessionId:     '5884104c-ae03-47b3-b65a-f00d3383605d',
  awsAlb:        'slqhnQ8pdyGnARM2O4jIiCgj3aUicibAsRye6l/1wBVP+kc2eVWf9L8Lx2gNPhODaLKFexTNDOtDFrqH+OTB6GRvXbTV8jzKUwqFSGxLtkO+crOYiiPuDdEk7saYZJTZmmHpG3le4qdmErHDkakzWzqNcVohPT9Mt2GI6XdEhxM+j0ah+nH1vfYPXvGR1Q==',
  clientVersion: 'v2.67.18',   // update if requests start failing with 400/403

  // Set to true to search for products instead of filling basket
  searchMode:    false,
  searchQuery:   'piim',
  searchLimit:   10,

  // Items to add to basket — {sku, quantity}
  // sku = 18-digit product_id string (leading zeros matter)
  items: [
    { sku: '000000000000139701', quantity: 2 },  // Alma piim 3.5% 1.5L
    // { sku: '000000000001033523', quantity: 1 },
  ],
};

// ─── INTERNALS ─────────────────────────────────────────────────────────────

const BASE    = 'https://barbora.ee';
const DELAY   = 400; // ms between adds — gentle rate limiting

const headers = {
  'Content-type':   'application/json',
  'ClientVersion':  CONFIG.clientVersion,
  'X-Session-ID':   CONFIG.sessionId,
  'Cookie':         `X-Session-ID=${CONFIG.sessionId}; AWSALB=${CONFIG.awsAlb}`,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ─── SEARCH MODE ───────────────────────────────────────────────────────────

async function searchProducts(query, limit = 10) {
  console.log(`\nSearching for: "${query}"\n`);
  const params = new URLSearchParams({
    'request.searchText': query,
    'request.limit':      limit,
  });
  const data = await apiGet(`/api/eshop/v1/constructor/autocomplete?${params}`);
  const products = data.products || [];
  if (!products.length) {
    console.log('No results found.');
    return;
  }
  products.forEach(p => {
    console.log(`  ${p.id}  €${p.price?.toFixed(2)}  ${p.title}`);
  });
  console.log(`\n${products.length} result(s). Copy an id into CONFIG.items as the sku.`);
}

// ─── FILL MODE ─────────────────────────────────────────────────────────────

async function getCartId() {
  const data = await apiGet('/proxy/api/v1/cart/summary');
  return data.id || null;
}

async function addItem(sku, quantity) {
  const body = {
    product_id: sku,
    quantity,
    unit:    0,
    web_url: `${BASE}/`,
  };
  const data = await apiPost('/api/eshop/v1/cart/item?returnCartInfo=true', body);
  // Extract current quantity for this item from the response
  const cartProducts = data?.cart?.slices?.[0]?.products ?? [];
  const added = cartProducts.find(p => p.product_id === sku || true); // response doesn't repeat sku
  const cartSize = cartProducts.length;
  return { cartSize, totalItems: data?.cart?.slices?.[0]?.products?.reduce((s, p) => s + p.quantity, 0) };
}

async function fillBasket() {
  // Validate config
  if (CONFIG.sessionId.startsWith('PASTE')) {
    console.error('❌  Set your sessionId and awsAlb in CONFIG before running.');
    process.exit(1);
  }
  if (!CONFIG.items.length) {
    console.error('❌  CONFIG.items is empty — nothing to add.');
    process.exit(1);
  }

  // Verify session
  console.log('Verifying session...');
  let user;
  try {
    user = await apiGet('/proxy/api/v1/user/info');
  } catch (e) {
    console.error(`❌  Session check failed: ${e.message}`);
    console.error('    Make sure X-Session-ID and AWSALB are correct and not expired.');
    process.exit(1);
  }
  console.log(`✓  Logged in as ${user.name} ${user.surname} (${user.email})\n`);

  // Get current cart state
  const cartId = await getCartId();
  console.log(`Cart ID: ${cartId ?? '(new cart)'}\n`);

  // Add items
  let successCount = 0;
  for (const { sku, quantity } of CONFIG.items) {
    process.stdout.write(`Adding ${quantity}× ${sku} ... `);
    try {
      const result = await addItem(sku, quantity);
      console.log(`✓  (cart now has ${result.cartSize} distinct item(s))`);
      successCount++;
    } catch (e) {
      console.log(`❌  ${e.message}`);
    }
    await sleep(DELAY);
  }

  console.log(`\nDone. ${successCount}/${CONFIG.items.length} items added.`);
  console.log('Open barbora.ee to confirm your basket.\n');
}

// ─── ENTRY ─────────────────────────────────────────────────────────────────

if (CONFIG.searchMode) {
  searchProducts(CONFIG.searchQuery, CONFIG.searchLimit).catch(e => {
    console.error('Search failed:', e.message);
    process.exit(1);
  });
} else {
  fillBasket().catch(e => {
    console.error('Unexpected error:', e.message);
    process.exit(1);
  });
}
