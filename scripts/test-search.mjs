import fs from 'node:fs'; import assert from 'node:assert/strict';
new Function(fs.readFileSync('assets/search.js', 'utf8'))();
const S = globalThis.Search;
const cat = JSON.parse(fs.readFileSync('catalog.json', 'utf8'));
const syn = JSON.parse(fs.readFileSync('config/synonyms.json', 'utf8'));
const ix = S.build(cat.items.concat([{ id: 'x1', title: 'Voicings de acordes en el piano', description: 'Cómo construir voicings', text: 'Los acordes sin fundamental suenan modernos', categories: ['Piano'], tags: ['voicings'] },
  { id: 'x2', title: 'Armonía funcional', description: 'Tónica y dominante', text: 'ejemplos en Re mayor para el teclado', categories: ['Piano'], tags: [] }]), syn);
const top = q => S.search(ix, q).results.map(r => r.it.title);
assert.equal(top('voicings')[0], 'Voicings de acordes en el piano');       // título
assert.equal(top('fundamental')[0], 'Voicings de acordes en el piano');     // sólo en el contenido
assert.equal(top('voicngs')[0], 'Voicings de acordes en el piano');        // error ortográfico
assert.equal(top('armonia')[0], 'Armonía funcional');                      // sin tilde
assert.ok(top('harmony').includes('Armonía funcional'));                   // sinónimo
assert.ok(top('qwen').some(t => /Qwen/.test(t)));                          // datos reales (semilla)
assert.ok(top('hermes').length >= 3);                                      // varias coincidencias
assert.deepEqual(top('zzzxq'), []);                                        // sin resultados
assert.ok(S.suggest(ix, 'voicngz').includes('voicings'));                  // sugerencia
console.log('búsqueda: todas las pruebas OK');
