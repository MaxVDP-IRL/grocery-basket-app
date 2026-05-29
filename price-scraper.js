#!/usr/bin/env node
// price-scraper.js — Nightly ingredient price fetcher for Korvi
//
// Reads all resolved SKUs from Supabase, fetches current prices from
// Barbora, Selver, and Rimi, writes to price_history, and updates
// last_price_eur on ingredient_skus.
//
// Requirements: Node.js 18+  (uses native fetch — no npm install needed)
//
// Run manually:
//   node price-scraper.js
//
// Schedule nightly:
//   macOS/Linux — crontab -e, add:
//     0 2 * * * cd /path/to/script && node price-scraper.js >> price-scraper.log 2>&1
//   Windows — Task Scheduler, run:
//     node C:\path\to\price-scraper.js  at 02:00 daily

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL     = 'https://vjeqsgsulhxvkshjoicg.supabase.co';
const SUPABASE_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZXFzZ3N1bGh4dmtzaGpvaWNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Nzk5NTEsImV4cCI6MjA5NTU1NTk1MX0.9SDRENFqfDLjT4YhCFmyVPzJZUQmLe9K29m638nIMmY';
const DELAY_MS         = 600;   // ms between requests — polite pacing
const BARBORA_VERSION  = 'v2.67.18';

// ── Supabase helpers ──────────────────────────────────────────────────────────

const SB_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: SB_HEADERS });
  if (!res.ok) throw new Error(`Supabase GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method:  'POST',
    headers: SB_HEADERS,
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST ${path} -> ${res.status}: ${await res.text()}`);
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method:  'PATCH',
    headers: SB_HEADERS,
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${path} -> ${res.status}: ${await res.text()}`);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const delay = ms => new Promise(r => setTimeout(r, ms));

// First 3 words of a display name — used as the search query for Barbora & Rimi
function searchQuery(displayName) {
  return (displayName || '').split(/\s+/).slice(0, 3).join(' ');
}

function log(msg)  { console.log(`[${new Date().toISOString()}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toISOString()}] WARNING  ${msg}`); }
function err(msg)  { console.error(`[${new Date().toISOString()}] ERROR    ${msg}`); }

// ── Rimi HTML parser ──────────────────────────────────────────────────────────
// Rimi search results are server-rendered HTML. Prices are embedded in
// data attributes on the product container elements — we extract them with
// regex since DOMParser is not available in Node.js.

function parseRimiHtml(html, limit) {
  const products = [];
  let pos = 0;

  while (products.length < limit) {
    const marker = html.indexOf('js-product-container', pos);
    if (marker === -1) break;

    // Walk back to opening tag
    let tagStart = marker;
    while (tagStart > 0 && html[tagStart] !== '<') tagStart--;

    // Walk forward to closing > of opening tag, respecting quoted attributes
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
    pos = tagEnd + 1;

    const codeMatch = tag.match(/data-product-code="(\d+)"/);
    if (!codeMatch) continue;
    const code = codeMatch[1];

    const gtmMatch = tag.match(/data-gtm-eec-product='([^']*)'/);
    if (!gtmMatch) continue;

    let gtm;
    try {
      const raw = gtmMatch[1];
      gtm = JSON.parse(raw.endsWith('}') ? raw : raw + '"}');
    } catch {
      continue;
    }

    if (gtm.price == null) continue;

    products.push({
      sku:   code,
      price: parseFloat(gtm.price),
      title: gtm.name || '',
    });
  }

  return products;
}

// ── Store price fetchers ──────────────────────────────────────────────────────

async function fetchBarboraPrice(sku, displayName) {
  const params = new URLSearchParams({
    'request.searchText': searchQuery(displayName),
    'request.limit':      '15',
  });
  const res = await fetch(
    `https://barbora.ee/api/eshop/v1/constructor/autocomplete?${params}`,
    { headers: { 'Content-type': 'application/json', 'ClientVersion': BARBORA_VERSION, 'X-Session-ID': '' } }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data    = await res.json();
  const product = (data.products || []).find(p => String(p.id) === String(sku));
  if (!product) return null;
  return typeof product.price === 'number' ? product.price : null;
}

async function fetchSelverPrice(sku) {
  // The filter[sku][eq] Elasticsearch endpoint returns 500 intermittently;
  // searching by SKU string directly is reliable and returns an exact match.
  const url = 'https://www.selver.ee/api/catalog/vue_storefront_catalog_et/product/_search'
            + `?q=${encodeURIComponent(sku)}&size=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const hit  = (data.hits?.hits ?? []).find(h => String(h._source?.sku) === String(sku));
  if (!hit) return null;
  const src   = hit._source;
  const price = src.final_price_incl_tax ?? src.price_incl_tax ?? null;
  return price != null ? parseFloat(price) : null;
}

async function fetchRimiPrice(sku, displayName) {
  const query = searchQuery(displayName);
  const url   = `https://www.rimi.ee/epood/ee/otsing?query=${encodeURIComponent(query)}:relevance`;
  const res   = await fetch(url, {
    headers: {
      'Accept':          'text/html',
      'Accept-Language': 'et-EE,et;q=0.9',
      'User-Agent':      'Mozilla/5.0 (compatible; KorviPriceScraper/1.0)',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html     = await res.text();
  const products = parseRimiHtml(html, 30);
  const match    = products.find(p => String(p.sku) === String(sku));
  return match ? match.price : null;
}

async function fetchPrice(row) {
  switch (row.supermarket) {
    case 'barbora': return fetchBarboraPrice(row.sku, row.display_name);
    case 'selver':  return fetchSelverPrice(row.sku);
    case 'rimi':    return fetchRimiPrice(row.sku, row.display_name);
    default:        throw new Error(`Unknown supermarket: ${row.supermarket}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('Starting Korvi price scraper...');

  // 1. Load all resolved SKU mappings from Supabase
  let skuRows;
  try {
    skuRows = await sbGet(
      '/ingredient_skus?select=id,ingredient_id,supermarket,sku,display_name&order=supermarket.asc'
    );
  } catch (e) {
    err(`Failed to load ingredient SKUs: ${e.message}`);
    process.exit(1);
  }

  if (!skuRows.length) {
    log('No ingredient SKUs found — nothing to scrape. Run the resolver first.');
    process.exit(0);
  }

  const stores = [...new Set(skuRows.map(r => r.supermarket))].join(', ');
  log(`Found ${skuRows.length} SKU mappings (${stores})`);

  const timestamp = new Date().toISOString();
  let succeeded = 0, notFound = 0, failed = 0;

  // 2. Fetch and record price for each SKU
  for (const row of skuRows) {
    const label = `${row.display_name} [${row.supermarket} / ${row.sku}]`;

    // Fetch current price from store
    let price;
    try {
      price = await fetchPrice(row);
    } catch (e) {
      err(`${label} — fetch failed: ${e.message}`);
      failed++;
      await delay(DELAY_MS);
      continue;
    }

    if (price === null) {
      warn(`${label} — SKU not found in search results`);
      notFound++;
      await delay(DELAY_MS);
      continue;
    }

    // Write to price_history
    try {
      await sbPost('/price_history', {
        ingredient_sku_id: row.id,
        price_eur:         price,
        was_on_promotion:  false,
        recorded_at:       timestamp,
      });
    } catch (e) {
      err(`${label} — failed to write price_history: ${e.message}`);
      failed++;
      await delay(DELAY_MS);
      continue;
    }

    // Update last_price_eur on ingredient_skus (non-fatal if this fails)
    try {
      await sbPatch(`/ingredient_skus?id=eq.${row.id}`, {
        last_price_eur:     price,
        last_price_seen_at: timestamp,
      });
    } catch (e) {
      warn(`${label} — price_history written but ingredient_skus update failed: ${e.message}`);
    }

    console.log(`  OK  EUR ${price.toFixed(2).padStart(6)}  ${label}`);
    succeeded++;

    await delay(DELAY_MS);
  }

  // 3. Summary
  log('');
  log(`Scrape complete — updated: ${succeeded}, not found: ${notFound}, errors: ${failed}`);
  if (failed > 0) {
    log('Exiting with code 1 due to errors.');
    process.exit(1);
  }
}

main().catch(e => {
  err(`Unhandled error: ${e.message}`);
  process.exit(1);
});

  // 3. Summary
  log('');
  log(`Scrape complete — updated: ${succeeded}, not found: ${notFound}, errors: ${failed}`);

  if (failed > 0) {
    log('Exiting with code 1 due to errors (check output above).');
    process.exit(1);
  }
}

main().catch(e => {
  err(`Unhandled error: ${e.message}`);
  process.exit(1);
});

  // 3. Summary
  log('');
  log(`Scrape complete — updated: ${succeeded}, not found: ${notFound}, errors: ${failed}`);

  if (failed > 0) {
    log('Exiting with code 1 due to errors (check output above).');
    process.exit(1);
  }
}

main().catch(e => {
  err(`Unhandled error: ${e.message}`);
  process.exit(1);
});


  // 3. Summary
  log('');
  log(`Scrape complete — updated: ${succeeded}, not found: ${notFound}, errors: ${failed}`);
  if (failed > 0) {
    log('Exiting with code 1 due to errors.');
    process.exit(1);
  }
}

main().catch(e => {
  err(`Unhandled error: ${e.message}`);
  process.exit(1);
});
