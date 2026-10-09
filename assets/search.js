// Motor de búsqueda sin dependencias: acentos, prefijos, errores ortográficos y sinónimos.
(function (root) {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tok = s => norm(s).split(/[^a-z0-9ñ]+/).filter(Boolean);
  const W = { title: 8, tags: 4, categories: 3, description: 3, headings: 2, text: 1 };

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let min = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < min) min = cur[j];
      }
      if (min > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function build(items, synonyms) {
    const inv = new Map(); // término -> Map(doc -> peso)
    items.forEach((it, d) => {
      for (const f in W) {
        const val = Array.isArray(it[f]) ? it[f].join(' ') : it[f];
        for (const t of tok(val)) {
          let m = inv.get(t); if (!m) inv.set(t, m = new Map());
          m.set(d, Math.min((m.get(d) || 0) + W[f], 40));
        }
      }
    });
    const syn = new Map();
    (synonyms || []).forEach(g => { const n = g.map(norm); n.forEach(t => syn.set(t, n)); });
    return { items, inv, vocab: [...inv.keys()], syn, N: items.length };
  }

  function expand(ix, term) { // [{t, w}] coincidencias exactas, por prefijo y aproximadas
    const out = new Map(); const put = (t, w) => { if (w > (out.get(t) || 0)) out.set(t, w); };
    if (ix.inv.has(term)) put(term, 1);
    if (term.length >= 3) for (const v of ix.vocab) if (v !== term && v.startsWith(term)) put(v, 0.7);
    const max = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
    if (max) for (const v of ix.vocab) if (!out.has(v) && lev(term, v, max) <= max) put(v, max === 2 ? 0.45 : 0.55);
    return out;
  }

  function search(ix, query) {
    const terms = [...new Set(tok(query))];
    if (!terms.length) return { results: [], terms };
    const score = new Map(); const hit = new Map();
    terms.forEach((term, qi) => {
      const cand = expand(ix, term);
      (ix.syn.get(term) || []).forEach(s => { if (s !== term && ix.inv.has(s)) cand.set(s, Math.max(cand.get(s) || 0, 0.8)); });
      for (const [t, w] of cand) {
        const post = ix.inv.get(t); const idf = Math.log(1 + ix.N / post.size);
        for (const [d, pw] of post) {
          score.set(d, (score.get(d) || 0) + w * idf * Math.log(1 + pw));
          (hit.get(d) || hit.set(d, new Set()).get(d)).add(qi);
        }
      }
    });
    const q = norm(query).trim(); const res = [];
    for (const [d, s] of score) {
      const it = ix.items[d]; let sc = s * (1 + hit.get(d).size / terms.length);
      if (hit.get(d).size === terms.length) sc *= 1.5;
      if (norm(it.title).includes(q)) sc *= 1.6;
      res.push({ it, score: sc, all: hit.get(d).size === terms.length });
    }
    res.sort((a, b) => b.score - a.score);
    return { results: res, terms };
  }

  function suggest(ix, query, n = 5) { // «¿Quisiste decir…?»: términos cercanos con más documentos
    const out = [];
    for (const term of tok(query)) {
      let best = null;
      for (const v of ix.vocab) {
        const d = lev(term, v, 3); if (d > 3) continue;
        const c = ix.inv.get(v).size;
        if (!best || d < best.d || (d === best.d && c > best.c)) best = { v, d, c };
      }
      if (best && best.v !== term) out.push(best.v);
    }
    return out.slice(0, n);
  }

  function snippet(it, terms, len = 140) {
    const t = it.text || ''; const n = norm(t);
    for (const term of terms) { const i = n.indexOf(term); if (i >= 0) { const s = Math.max(0, i - 40); return (s ? '…' : '') + t.slice(s, s + len) + '…'; } }
    return '';
  }

  const api = { build, search, suggest, snippet, norm, tok };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Search = api;
})(typeof window !== 'undefined' ? window : globalThis);
