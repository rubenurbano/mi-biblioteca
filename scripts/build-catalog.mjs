// Genera catalog.json rastreando el portal de GitHub Pages. Sin servidor, sin credenciales.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const CFG_PATH = process.env.CONFIG || 'config/sources.json';
const OUT = process.env.OUT || 'catalog.json';
const cfg = JSON.parse(await fs.readFile(CFG_PATH, 'utf8'));
const now = new Date().toISOString();
const today = now.slice(0, 10);
const sha = (s, n = 12) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const log = (...a) => console.log(...a);

let prev = { items: [], collections: [] };
try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}
const prevByUrl = new Map(prev.items.map(i => [i.url, i]));

// ---------- URLs ----------
const origins = cfg.origins.map(o => new URL(o).origin);
const isOwn = u => origins.includes(u.origin);
function norm(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = ''; u.search = '';
    u.pathname = u.pathname.replace(/\/index\.html?$/i, '/');
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u;
  } catch { return null; }
}
const excluded = u => cfg.excludePaths.some(p => (u.pathname + '/').startsWith(p.replace(/\/$/, '') + '/')) ||
  (cfg.selfPath && (u.pathname + '/').startsWith(cfg.selfPath.replace(/\/$/, '') + '/'));
const topPath = u => '/' + (u.pathname.split('/')[1] || '');
const ext = u => (u.pathname.match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase() || '';
const MEDIA = { mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', pdf: 'pdf', mp4: 'video' };

// ---------- red ----------
async function get(url, prevItem) {
  let last;
  for (let t = 0; t < 3; t++) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25000);
      const headers = { 'user-agent': 'biblioteca-tutoriales-bot', accept: 'text/html,*/*' };
      if (prevItem?.etag) headers['if-none-match'] = prevItem.etag;
      const r = await fetch(url, { headers, signal: ctl.signal, redirect: 'follow' });
      clearTimeout(to);
      if (r.status === 304) return { status: 304 };
      if (r.status === 404 || r.status === 410) return { status: r.status };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const type = r.headers.get('content-type') || '';
      return { status: 200, type, etag: r.headers.get('etag') || '', html: /html|xml|text/.test(type) ? await r.text() : '' };
    } catch (e) { last = e; await new Promise(s => setTimeout(s, 800 * (t + 1))); }
  }
  return { status: 0, error: String(last?.message || last) };
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { await fn(items[i++]); } }));
}

// ---------- extracción ----------
const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const stripBrand = t => clean(t).replace(/\s*(?:[—–|\-·]\s*)?\bby\s+Rub[eé]n Sbarsky\s*$/i, '').replace(/\s*[—–|·-]\s*Rub[eé]n Sbarsky\s*$/i, '');
function extract(html) {
  const $ = cheerio.load(html);
  const meta = n => clean($(`meta[name="${n}"],meta[property="${n}"]`).attr('content'));
  const title = stripBrand(meta('og:title') || $('h1').first().text() || $('title').first().text());
  const links = $('a[href]').map((_, a) => {
    const el = $(a);
    const full = clean(el.text());
    let t = clean(el.find('h1,h2,h3,h4,strong,[class*=title]').first().text());
    if (!t) { const c = clean(el.children().first().text()); if (c && c.length < full.length) t = c; }
    return { href: el.attr('href'), title: t, text: full, desc: t ? clean(full.replace(t, '')) : '' };
  }).get();
  $('script,style,noscript,nav,footer,template,svg').remove();
  const headings = $('h1,h2,h3').map((_, e) => clean($(e).text())).get().filter(Boolean).slice(0, 40);
  let description = meta('description') || meta('og:description');
  if (!description) description = $('p').map((_, e) => clean($(e).text())).get().find(p => p.length > 60) || '';
  const text = clean($('body').text()).slice(0, cfg.textLimit);
  let date = meta('article:published_time') || meta('date') || $('time[datetime]').first().attr('datetime') || '';
  const d = date && new Date(date); date = d && !isNaN(d) ? d.toISOString().slice(0, 10) : '';
  return { title, description: description.slice(0, 300), headings, text, date, keywords: meta('keywords').split(',').map(clean).filter(Boolean), links };
}

// ---------- descubrimiento ----------
const stats = { collections: 0, pages: 0, reused: 0, failed: 0, removed: 0, added: 0, updated: 0 };
const found = new Map(); // url -> {url, collection, kind, hint}
const failedCollections = new Set();
const collections = [];

const portal = await get(cfg.portal);
if (portal.status !== 200) { console.error('No se pudo leer el portal; se conserva el catálogo anterior.', portal); process.exit(1); }
const portalDoc = extract(portal.html);
const colMap = new Map();
for (const l of portalDoc.links) {
  const u = norm(l.href, cfg.portal);
  if (!u || !isOwn(u) || u.pathname === '/' || excluded(u)) continue;
  const label = clean((l.title || l.text).replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '').replace(/^Colecci[oó]n\s+(Tutoriales\s+(de\s+)?)?/i, '')) || topPath(u).slice(1);
  if (!colMap.has(u.href)) colMap.set(u.href, { url: u.href, label: (cfg.collectionLabels || {})[topPath(u)] || label, description: l.desc });
}
for (const s of cfg.extraSeeds) { const u = norm(s, cfg.portal); if (u && !colMap.has(u.href)) colMap.set(u.href, { url: u.href, label: topPath(u).slice(1), description: '' }); }
log(`Portal: ${colMap.size} colecciones`);

async function crawlCollection(col) {
  const base = new URL(col.url); const prefix = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
  const seen = new Set([base.href]); let frontier = [base.href]; let ok = false;
  const sm = await get(new URL('sitemap.xml', base.href + '/').href);
  if (sm.status === 200 && /<urlset/.test(sm.html || '')) {
    for (const m of sm.html.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = norm(m[1]);
      if (u && isOwn(u) && (u.pathname + '/').startsWith(prefix) && u.href !== base.href && !found.has(u.href)) { seen.add(u.href); found.set(u.href, { url: u.href, collection: col.label, kind: 'tutorial', hint: {} }); }
    }
  }
  for (let depth = 0; depth <= cfg.maxDepth && frontier.length; depth++) {
    const next = [];
    for (const url of frontier) {
      const r = await get(url);
      if (r.status !== 200) { if (depth === 0) return false; continue; }
      if (depth === 0) ok = true;
      const doc = extract(r.html);
      for (const l of doc.links) {
        const u = norm(l.href, url);
        if (!u || !/^https?:$/.test(u.protocol)) continue;
        const hint = { title: l.title, desc: l.desc || (l.title ? '' : l.text) };
        if (u.hostname === 'github.com') {
          if (u.pathname.toLowerCase().startsWith('/' + cfg.githubOwner.toLowerCase() + '/') && u.pathname.split('/').filter(Boolean).length === 2 && !found.has(u.href))
            found.set(u.href, { url: u.href, collection: col.label, kind: 'proyecto', hint });
          continue;
        }
        if (!isOwn(u) || excluded(u)) continue;
        const inCol = (u.pathname + '/').startsWith(prefix);
        const e = ext(u);
        if (MEDIA[e]) { if (!found.has(u.href)) found.set(u.href, { url: u.href, collection: col.label, kind: MEDIA[e], hint }); continue; }
        if (e && !/^html?$/.test(e)) continue;
        if (u.pathname === '/' || u.href === base.href) continue;
        if (!found.has(u.href)) found.set(u.href, { url: u.href, collection: col.label, kind: 'tutorial', hint });
        if (inCol && !seen.has(u.href) && seen.size < cfg.maxPagesPerCollection) { seen.add(u.href); next.push(u.href); }
      }
    }
    frontier = next;
  }
  return ok;
}
for (const col of colMap.values()) {
  const ok = await crawlCollection(col);
  if (!ok) { failedCollections.add(col.label); log(`  ! colección sin acceso: ${col.label} (se conservan sus entradas anteriores)`); }
  else { collections.push(col); stats.collections++; }
}
for (const col of colMap.values()) found.delete(norm(col.url).href); // los índices no son tutoriales
log(`Descubiertos: ${found.size} enlaces`);

// ---------- procesar páginas (incremental) ----------
const items = [];
await pool([...found.values()], cfg.concurrency, async f => {
  const old = prevByUrl.get(f.url);
  const base = { id: sha(f.url, 10), url: f.url, collection: f.collection, kind: f.kind, lastSeen: today };
  if (f.kind !== 'tutorial') {
    const hd = f.hint.title ? f.hint.desc : '';
    const t = f.hint.title || f.hint.desc || decodeURIComponent(f.url.split('/').filter(Boolean).pop() || f.url).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    items.push({ ...base, title: stripBrand(t), description: hd.replace(/\s*by Rub[eé]n Sbarsky\s*/i, ' ').trim().slice(0, 300), headings: [], text: '', date: old?.date || today, firstSeen: old?.firstSeen || today, updated: old?.updated || today, hash: sha(t + hd) });
    return;
  }
  const r = await get(f.url, old);
  if (r.status === 304 && old) { items.push({ ...old, ...base, firstSeen: old.firstSeen }); stats.reused++; return; }
  if (r.status === 404 || r.status === 410) return; // retirado
  if (r.status !== 200 || !r.html) { if (old) { items.push({ ...old, failures: (old.failures || 0) + 1 }); stats.failed++; } return; }
  const x = extract(r.html); stats.pages++;
  const hash = sha(x.title + x.text, 16);
  const changed = !old || old.hash !== hash;
  items.push({ ...base, title: x.title || f.hint.title || f.url, description: x.description || f.hint.desc || '', headings: x.headings, text: x.text, keywords: x.keywords,
    date: x.date || old?.date || today, firstSeen: old?.firstSeen || today, updated: changed ? today : (old?.updated || today), hash, etag: r.etag || '' });
});
for (const o of prev.items) if (failedCollections.has(o.collection) && !items.find(i => i.url === o.url)) items.push(o); // colección caída: conservar

// ---------- deduplicar ----------
const tkey = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const canon = new Map(); const result = [];
for (const it of items.sort((a, b) => a.url.length - b.url.length || a.url.localeCompare(b.url))) {
  const keys = [it.kind === 'tutorial' && it.hash ? 'h:' + it.hash : null, it.kind !== 'proyecto' ? 't:' + it.kind + ':' + tkey(it.title) : null].filter(Boolean);
  const hit = keys.map(k => canon.get(k)).find(Boolean);
  if (hit) { (hit.alsoAt ||= []).push(it.url); continue; }
  keys.forEach(k => canon.set(k, it)); result.push(it);
}

// ---------- temas automáticos (TF-IDF, sin lista cerrada) ----------
const STOP = new Set(('de la el en y a los las del se que por con para un una es al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos yo otro otras otra tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros the of and to in is for on with as by this that it from are be or an at your you how use using sbarsky ruben tutorial tutoriales interactivo paso pasos guia desde cero').split(' '));
const toks = s => tkey(s).split(' ').filter(w => w.length > 2 && w.length < 25 && !STOP.has(w) && !/^\d+$/.test(w));
const docs = result.map(it => { const m = new Map(); const add = (s, w) => toks(s).forEach(t => m.set(t, (m.get(t) || 0) + w)); add(it.title, 5); (it.headings || []).forEach(h => add(h, 2)); add(it.description || '', 2); add(it.text || '', 1); return m; });
const df = new Map(); docs.forEach(m => m.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
const N = docs.length || 1;
result.forEach((it, i) => {
  const sc = [...docs[i]].map(([t, tf]) => [t, Math.log(1 + tf) * Math.log(1 + N / df.get(t))]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  it.tags = sc.slice(0, 8);
  const recurring = sc.filter(t => df.get(t) >= 2 && df.get(t) <= N * 0.35).slice(0, 2);
  it.categories = [...new Set([it.collection, ...(it.keywords || []).slice(0, 3), ...recurring].filter(Boolean))];
  delete it.keywords;
});

// ---------- seguridad: no sustituir un buen índice por uno claramente roto ----------
if (prev.items.length > 10 && result.length < prev.items.length * cfg.minKeepRatio && !process.env.FORCE) {
  console.error(`Abortado: ${result.length} entradas frente a ${prev.items.length} anteriores. Se conserva el índice anterior (FORCE=1 para forzar).`); process.exit(1);
}
const inResult = new Set(result.flatMap(r => [r.url, ...(r.alsoAt || [])]));
stats.added = result.filter(i => !prevByUrl.has(i.url)).length;
stats.updated = result.filter(i => prevByUrl.has(i.url) && i.updated === today && prevByUrl.get(i.url).updated !== today).length;
stats.removed = prev.items.filter(o => !failedCollections.has(o.collection) && !inResult.has(o.url)).length;
result.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));

const catalog = { version: 1, generatedAt: now, stats: { total: result.length, ...stats }, collections: collections.length ? collections : prev.collections, items: result };
await fs.writeFile(OUT + '.tmp', JSON.stringify(catalog));
await fs.rename(OUT + '.tmp', OUT);
const sum = `Catálogo: ${result.length} entradas · nuevas ${stats.added} · modificadas ${stats.updated} · retiradas ${stats.removed} · sin cambios ${stats.reused} · fallos ${stats.failed}`;
log(sum);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, sum + '\n');
