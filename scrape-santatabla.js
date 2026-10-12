/*
 * KiteCo · Actualizador semanal de precios desde Santa Tabla
 * ---------------------------------------------------------------
 * Entra a cada ficha de producto, toca cada talle, lee el precio real,
 * lo convierte a USD con el dólar que publica Santa Tabla y actualiza
 * productos.json (manteniendo fotos, descripciones, specs, etc.).
 *
 * Correr:  node scrape-santatabla.js
 * Requiere: node 18+  ·  npm install puppeteer
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const CONFIG = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
const PRODUCTS_PATH = CONFIG.productosPath || (__dirname + '/productos.json');

// "ARS 3.303.313" -> 3303313
function parseARS(s) {
  const d = (s || '').replace(/[^\d]/g, '');
  return d ? parseInt(d, 10) : NaN;
}

async function getDolar(page) {
  try {
    await page.goto(CONFIG.dolarUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const txt = await page.evaluate(() => document.body.innerText || '');
    const m = txt.match(/Banco\s*Naci[oó]n[^\d]*([\d.]+)/i);
    if (m) return parseInt(m[1].replace(/\./g, ''), 10);
  } catch (e) { console.warn('No pude leer el dólar del banner:', e.message); }
  return null;
}

async function harvestProduct(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // los botones de talle se cargan un instante después
  try { await page.waitForSelector('.ev-medidaSel', { timeout: 15000 }); } catch (_) {}
  await new Promise(r => setTimeout(r, 1500));

  return await page.evaluate(async () => {
    const out = [];
    const money = () => (document.querySelector('.money')?.innerText || '').trim();
    const hasJq = typeof window.$ !== 'undefined';
    const count = hasJq ? window.$('.ev-medidaSel').length
                        : document.querySelectorAll('.ev-medidaSel').length;
    for (let i = 0; i < count; i++) {
      let talle = '';
      if (hasJq) { window.$('.ev-medidaSel').eq(i).trigger('click'); talle = window.$('.ev-medidaSel').eq(i).text().trim(); }
      else { const el = document.querySelectorAll('.ev-medidaSel')[i]; el.click(); talle = el.textContent.trim(); }
      await new Promise(r => setTimeout(r, 850)); // esperar a que actualice el precio
      out.push({ talle, ars: money() });
    }
    return out;
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const dolar = (await getDolar(page)) || CONFIG.fallbackDolar || 1490;
  console.log('Dólar Santa Tabla:', dolar);

  const data = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
  const byId = Object.fromEntries(data.productos.map(p => [p.id, p]));

  for (const item of CONFIG.productos) {
    const p = byId[item.id];
    if (!p) { console.warn('⚠ no existe en el json:', item.id); continue; }
    try {
      const raw = await harvestProduct(page, item.url);
      const vars = raw
        .map(r => ({
          talle: item.unit ? `${r.talle} ${item.unit}`.trim() : r.talle,
          usd: Math.round(parseARS(r.ars) / dolar)
        }))
        .filter(v => v.talle && isFinite(v.usd) && v.usd > 0);

      if (vars.length) {
        p.variantes = vars;
        p.usd = Math.min(...vars.map(v => v.usd));
        console.log(`✓ ${item.id}: ${vars.length} talles · desde USD ${p.usd}`);
      } else {
        console.warn(`⚠ ${item.id}: no leí precios (¿cambió la página o está sin stock?)`);
      }
    } catch (e) {
      console.error(`✗ ${item.id}: ${e.message}`);
    }
  }

  data.dolar = dolar;
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(data, null, 2));
  await browser.close();
  console.log('✓ productos.json actualizado.');
})();
