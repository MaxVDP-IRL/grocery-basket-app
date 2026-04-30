// resolver.js — Ingredient → Barbora SKU mapping tool

// Estonian search terms for each ingredient.
// The search box is pre-filled with these — edit in the UI if a term gives bad results.
const ET = {
  "Arborio rice":          "arborio riis",
  "Avocado":               "avokaado",
  "Beef mince":            "veisehakkliha",
  "Beef stock cube":       "veisepuljong kuubik",
  "Beef strips":           "veiseliha ribad",
  "Beef strips or steak":  "veiseliha",
  "Bell pepper":           "paprika",
  "Black olives":          "mustad oliivid",
  "Breadcrumbs":           "riivsai",
  "Broccoli":              "brokkoli",
  "Burger buns":           "burgerisai",
  "Butter":                "või",
  "Caesar dressing":       "caesari kaste",
  "Celery":                "seller",
  "Cheddar cheese":        "cheddar juust",
  "Cherry tomatoes":       "kirsitomatid",
  "Chicken breast":        "kana rinnafile",
  "Chicken stock cube":    "kanapuljong kuubik",
  "Chicken thigh":         "kana reietükk",
  "Coconut milk":          "kookospiim",
  "Cooked prawns":         "krevetid",
  "Corn starch":           "maisitärklis",
  "Crusty bread":          "koorikleib",
  "Cucumber":              "kurk",
  "Curry powder":          "karripulber",
  "Dijon mustard":         "dijoni sinep",
  "Dried basil":           "kuivatatud basiilik",
  "Dried chilli flakes":   "tšillipulber",
  "Dried dill":            "kuivatatud till",
  "Dried oregano":         "pune",
  "Dried parsley":         "kuivatatud petersell",
  "Dried rosemary":        "rosmariin",
  "Dried thyme":           "tüümian",
  "Egg":                   "muna",
  "Egg noodles":           "munanudlid",
  "Feta cheese":           "feta juust",
  "Flour tortillas":       "tortilla",
  "Fresh dill":            "värske till",
  "Frozen peas":           "külmutatud herned",
  "Garlic":                "küüslauk",
  "Garlic powder":         "küüslaugupulber",
  "Ground cumin":          "köömned",
  "Heavy cream":           "vahukoor",
  "Honey":                 "mesi",
  "Hummus":                "hummus",
  "Iceberg lettuce":       "jäissalat",
  "Ketchup":               "ketšup",
  "Lemon":                 "sidrun",
  "Lime":                  "laim",
  "Long grain rice":       "pikateraline riis",
  "Milk":                  "piim",
  "Mozzarella cheese":     "mozzarella",
  "Mushrooms":             "šampinjonid",
  "Mustard":               "sinep",
  "Natural yogurt":        "naturaalne jogurt",
  "Olive oil":             "oliiviõli",
  "Onion":                 "sibul",
  "Pappardelle pasta":     "pappardelle",
  "Paprika":               "paprikapulber",
  "Parmesan cheese":       "parmesan",
  "Penne pasta":           "penne",
  "Plain flour":           "nisujahu",
  "Pork mince":            "seahakkliha",
  "Pork sausages":         "seavorstid",
  "Pork tenderloin":       "seafilee",
  "Potato":                "kartul",
  "Potatoes":              "kartul",
  "Red lentils":           "punased läätsed",
  "Red onion":             "punane sibul",
  "Ricotta cheese":        "ricotta",
  "Romaine lettuce":       "rooma salat",
  "Salmon fillet":         "lõhe file",
  "Sesame oil":            "seesamiõli",
  "Sour cream":            "hapukoor",
  "Soy sauce":             "sojakaste",
  "Spaghetti":             "spaghetti",
  "Spinach":               "spinat",
  "Spring onion":          "roheline sibul",
  "Sunflower oil":         "päevalilleõli",
  "Tikka masala paste":    "tikka masala",
  "Tinned black beans":    "mustad oad konserv",
  "Tinned chickpeas":      "kikerherned konserv",
  "Tinned corn":           "mais konserv",
  "Tinned kidney beans":   "punased oad konserv",
  "Tinned tomatoes":       "tomatid konserv",
  "Tinned tuna":           "tuunikala konserv",
  "Tomato":                "tomat",
  "Tomato paste":          "tomatipasta",
  "Vegetable stock cube":  "köögiviljapuljong",
  "White fish fillet":     "valge kala file",
  "Zucchini":              "suvikõrvits",
};

const INGREDIENTS = [
  "Arborio rice","Avocado","Beef mince","Beef stock cube","Beef strips",
  "Beef strips or steak","Bell pepper","Black olives","Breadcrumbs","Broccoli",
  "Burger buns","Butter","Caesar dressing","Celery","Cheddar cheese",
  "Cherry tomatoes","Chicken breast","Chicken stock cube","Chicken thigh",
  "Coconut milk","Cooked prawns","Corn starch","Crusty bread",
  "Cucumber","Curry powder","Dijon mustard","Dried basil","Dried chilli flakes",
  "Dried dill","Dried oregano","Dried parsley","Dried rosemary",
  "Dried thyme","Egg","Egg noodles","Feta cheese","Flour tortillas","Fresh dill",
  "Frozen peas","Garlic","Garlic powder","Ground cumin","Heavy cream","Honey",
  "Hummus","Iceberg lettuce","Ketchup","Lemon","Lime",
  "Long grain rice","Milk","Mozzarella cheese","Mushrooms","Mustard",
  "Natural yogurt","Olive oil","Onion","Pappardelle pasta","Paprika",
  "Parmesan cheese","Penne pasta","Plain flour",
  "Pork mince","Pork sausages","Pork tenderloin","Potato","Potatoes","Red lentils",
  "Red onion","Ricotta cheese","Romaine lettuce","Salmon fillet","Sesame oil",
  "Sour cream","Soy sauce","Spaghetti","Spinach","Spring onion","Sunflower oil",
  "Tikka masala paste","Tinned black beans","Tinned chickpeas",
  "Tinned corn","Tinned kidney beans","Tinned tomatoes","Tinned tuna","Tomato",
  "Tomato paste","Vegetable stock cube","White fish fillet","Zucchini"
];

// ── State ─────────────────────────────────────────────────────────────────────

let mapped    = {};  // { ingredientName: { sku, title, price, image } }
let skipped   = new Set();
let current   = 0;  // index into unmapped ingredients
let results   = []; // current search results

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const stored = await chrome.storage.local.get('ingredientMap');
  mapped  = stored.ingredientMap || {};
  skipped = new Set();
  renderAll();
}

function unmapped() {
  return INGREDIENTS.filter(i => !mapped[i]);
}

function currentIngredient() {
  const list = unmapped();
  return list[current] || null;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  updateProgress();
  renderMappedSidebar();
  renderMain();
}

function updateProgress() {
  const total   = INGREDIENTS.length;
  const done    = Object.keys(mapped).length;
  document.getElementById('progress-pill').textContent = `${done} / ${total}`;
}

function renderMappedSidebar() {
  const el   = document.getElementById('mapped-list');
  const keys = Object.keys(mapped);
  if (!keys.length) {
    el.innerHTML = '<div style="color:#aaa;font-size:13px">Nothing mapped yet.</div>';
    return;
  }
  el.innerHTML = keys.map(name => {
    const m = mapped[name];
    return `
      <div class="mapped-item">
        <span class="mapped-check">✓</span>
        <span class="mapped-name">${esc(name)}</span>
        <span class="mapped-product" title="${esc(m.title)}">${esc(m.title)}</span>
        <button class="mapped-undo" data-name="${esc(name)}" title="Undo">×</button>
      </div>`;
  }).join('');
  el.querySelectorAll('.mapped-undo').forEach(btn => {
    btn.addEventListener('click', () => undoMapping(btn.dataset.name));
  });
}

function renderMain() {
  const col  = document.getElementById('left-col');
  const todo = unmapped();

  if (!todo.length) {
    col.innerHTML = `
      <div class="done-banner">
        <h2>✓ All ${INGREDIENTS.length} ingredients mapped</h2>
        <p>Click "Download Map ↓" in the top bar to save your ingredient-map.json file.</p>
      </div>`;
    return;
  }

  // Clamp current index
  if (current >= todo.length) current = todo.length - 1;
  const name = todo[current];

  const etTerm = ET[name] || name;

  col.innerHTML = `
    <div class="ingredient-card">
      <div class="ingredient-label">Ingredient ${current + 1} of ${todo.length} remaining</div>
      <div class="ingredient-name">${esc(name)}</div>
      <div class="search-row">
        <input id="search-input" type="text" value="${esc(etTerm)}" placeholder="Otsi Barborast…">
        <button class="btn-search" id="search-btn">Search</button>
      </div>
    </div>

    <div class="nav-row">
      <button class="btn-nav" id="prev-btn" ${current === 0 ? 'disabled' : ''}>← Previous</button>
      <button class="btn-nav" id="next-btn" ${current >= todo.length - 1 ? 'disabled' : ''}>Next →</button>
      <button class="btn-nav btn-skip" id="skip-btn">Skip for now</button>
    </div>

    <div id="results-area">
      <div class="status-msg">Press Search to find matches on Barbora.</div>
    </div>

    <div class="mapped-section" id="mapped-section" style="display:none">
      <div class="mapped-header">Currently mapped to</div>
      <div id="current-mapping"></div>
    </div>
  `;

  document.getElementById('search-btn').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('prev-btn')?.addEventListener('click', () => { current--; renderMain(); });
  document.getElementById('next-btn')?.addEventListener('click', () => { current++; renderMain(); });
  document.getElementById('skip-btn').addEventListener('click', () => {
    skipped.add(name);
    if (current < todo.length - 1) current++;
    renderMain();
  });

  // Auto-search on load
  doSearch();
}

// ── Search ────────────────────────────────────────────────────────────────────

async function doSearch() {
  const query = document.getElementById('search-input')?.value?.trim();
  if (!query) return;

  const area = document.getElementById('results-area');
  area.innerHTML = '<div class="status-msg">Searching…</div>';

  const resp = await chrome.runtime.sendMessage({ type: 'SEARCH', query, limit: 9 });

  if (resp.error) {
    area.innerHTML = `<div class="status-msg" style="color:#d93025">Error: ${esc(resp.error)}<br>Make sure you are logged into Barbora.ee.</div>`;
    return;
  }
  if (!resp.results || !resp.results.length) {
    area.innerHTML = `<div class="status-msg">No results. Try a different search term.</div>`;
    return;
  }

  results = resp.results;
  renderResults();
}

function renderResults() {
  const area = document.getElementById('results-area');
  const name = currentIngredient();

  area.innerHTML = `
    <div class="results-grid">
      ${results.map((p, i) => `
        <div class="result-card" id="card-${i}">
          <img src="${esc(p.image || '')}" alt="" onerror="this.style.display='none'">
          <div class="result-card-title">${esc(p.title)}</div>
          <div class="result-card-price">€${(p.price || 0).toFixed(2)}</div>
          <div class="result-card-sku">${esc(p.sku)}</div>
          <button class="select-btn" data-idx="${i}">Select ✓</button>
        </div>
      `).join('')}
    </div>
  `;

  area.querySelectorAll('.select-btn').forEach(btn => {
    btn.addEventListener('click', () => selectProduct(results[parseInt(btn.dataset.idx)]));
  });
}

// ── Mapping ───────────────────────────────────────────────────────────────────

async function selectProduct(product) {
  const name = currentIngredient();
  if (!name) return;

  mapped[name] = {
    sku:   product.sku,
    title: product.title,
    price: product.price,
    image: product.image || '',
  };

  await chrome.storage.local.set({ ingredientMap: mapped });

  // Advance to next unmapped
  const todo = unmapped();
  if (current >= todo.length) current = Math.max(0, todo.length - 1);

  renderAll();
}

async function undoMapping(name) {
  delete mapped[name];
  await chrome.storage.local.set({ ingredientMap: mapped });
  renderAll();
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportMap() {
  const data = JSON.stringify(mapped, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'ingredient-map.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.getElementById('export-btn').addEventListener('click', exportMap);
init();
