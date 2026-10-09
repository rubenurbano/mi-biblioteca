# Mi biblioteca de tutoriales

Buscador personal de todos tus tutoriales de GitHub Pages. Estático, gratuito, sin servidor ni credenciales.

## Arquitectura
- **Descubrimiento**: `scripts/build-catalog.mjs` parte del portal (`config/sources.json`), detecta cada colección, lee su `sitemap.xml` si existe y sigue los enlaces de su índice (hasta 2 niveles). Reconoce tres tipos de entrada: páginas de tutorial (de la colección o sitios propios como `/qwen-3-8-max-api/`), proyectos en `github.com/rubenurbano/*` y audio/PDF/vídeo. No necesita la API de GitHub ni tokens.
- **Índice**: `catalog.json` (título, descripción, encabezados, texto, fecha, categorías y etiquetas automáticas por TF-IDF, sin lista cerrada). Se genera en GitHub Actions.
- **Duplicados**: se normaliza la URL (sin `#`, `?` ni `index.html`) y se fusionan páginas con el mismo contenido o el mismo título; la copia queda en `alsoAt`.
- **Búsqueda**: en el navegador (`assets/search.js`): título, etiquetas, descripción y contenido, prefijos, errores de ortografía, sin tildes y sinónimos (`config/synonyms.json`, edítalo a tu gusto).
- **Fecha**: la de la página (`article:published_time` o `<time>`) si existe; si no, el día en que el rastreador la vio por primera vez.

## Publicar (una vez)
1. Crea un repositorio público nuevo (p. ej. `mi-biblioteca`) y sube todo el contenido de esta carpeta a la rama `main`.
2. En **Settings → Pages → Source** elige **GitHub Actions**.
3. En **Actions → Actualizar catálogo y publicar → Run workflow**. En 1–2 minutos estará en `https://rubenurbano.github.io/mi-biblioteca/`.
4. Opcional: añade ese enlace como tarjeta en tu portal.

## Actualización diaria
- El workflow se ejecuta cada día (05:17 UTC), al cambiar la app o la configuración, y a mano (botón *Run workflow*; en la app, «Sincronizar en GitHub» abre esa página).
- Sólo vuelve a procesar lo nuevo o modificado, guarda `catalog.json` en el repositorio y despliega.
- **Si falla** (portal caído, o menos del 50 % de las entradas anteriores), no se despliega nada y sigue el índice anterior. Si una colección no responde, se conservan sus entradas. Una página que da 404 se retira.
- El botón «Actualizar» de la app sólo recarga el catálogo ya publicado; la sincronización real es el workflow, porque un sitio estático no puede ejecutar código en GitHub por sí mismo.
- Actualizar el catálogo y publicar tus tutoriales son procesos distintos: tus repositorios siguen publicándose como siempre.

## Mantenimiento
- Cada colección nueva debe tener tarjeta en el portal para descubrirse; si no, añádela en `extraSeeds`.
- Si una etiqueta de colección sale rara, fíjala en `collectionLabels` (por ejemplo `{"/ruben-urbano-piano": "Piano"}`).
- Cada ejecución escribe un resumen (nuevas, modificadas, retiradas, fallos) en la pestaña del workflow.

## Limitaciones
- Sólo se indexa el HTML que el servidor entrega: contenido generado por JavaScript tras la carga no se lee. Los PDF y audios se indexan por su título y enlace.
- `catalog.json` incluye datos de arranque (`"seed": true`) tomados de tu colección de IA; el primer workflow lo sustituye.
- `/area-privada/` está excluida; añade más rutas en `excludePaths`.
- Los favoritos se guardan en el navegador (no se sincronizan entre dispositivos).
- Con miles de entradas, `catalog.json` ronda varios MB (viaja comprimido); si molestara, baja `textLimit`.

Pruebas locales: `npm install && npm test`.
