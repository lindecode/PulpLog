# Propuesta: modo «archivo grande» y memoria en seguimiento largo

Estado: planteamiento (sin implementar) · Fecha: 2026-11-26

## Objetivo

1. Abrir archivos **locales** de 1 GB o más (y en general mayores que lo que cabe en la vista)
   sin cargarlos en memoria: navegar, buscar, filtrar por nivel y seguir en vivo.
2. Que una pestaña que sigue un log durante días **no agote la RAM**, sea local, Docker o remota.

Fuera de alcance: archivos remotos (SSH/WSL) grandes. Siguen como hoy: últimas N líneas, o el
archivo completo solo si cabe en el presupuesto (ver «Remotos» abajo).

## Situación actual

PulpLog carga el archivo entero en la vista. Topes vigentes:

| Tope | Dónde | Efecto al superarlo |
|---|---|---|
| 256 MB decodificados | `MAX_FILE_BYTES` (`streamLimits.cjs`), `LogTab.jsx` | no abre el archivo |
| 128M caracteres | `appendChunk` (`src/components/LogTab.jsx`) | error `file_memory_limit` |
| 1 millón de filas | `appendCompleteLines` (`src/components/LogTab.jsx`) | error `file_memory_limit` |
| 500k filas / 64 MB en vivo | `appendRecentItems` (`src/logProcessing.mjs`) | descarta las más antiguas (solo Docker y remoto) |

Cada fila clasificada (nivel, hora, tokens de resaltado) ocupa varias veces su texto. 1 GB son
unos 5–10 millones de líneas: cargarlo así necesitaría 4–10 GB en el proceso de la vista, más
allá de lo que Electron permite por pestaña. **Subir los topes no es una solución.**

### Seguimiento largo hoy

- **Docker y remoto:** ya acotados. `appendRecentItems` conserva las últimas `maxLiveLines`
  filas (configurable, 100k–2M) y como máximo ~64 MB; lo anterior se descarta.
- **Archivo local en vivo:** *no* se recorta. Las líneas nuevas se suman a `itemsRef` hasta
  llegar a 1 millón de filas o 128M caracteres; entonces el seguimiento **se detiene con
  `file_memory_limit`**. No se agota la RAM, pero la pestaña deja de seguir el log.
  Además, cada lote copia el arreglo completo (`setClassified([...itemsRef.current])`),
  así que el costo de cada actualización crece con el tamaño de la pestaña.
- **Lo que no está acotado en ningún modo:** marcas, selección y resultados de búsqueda guardan
  números de línea que, al recortar, apuntan a filas descartadas.

## Diseño

### Cuándo se activa

Automático para archivos **locales sin comprimir** cuyo tamaño supere un umbral
(propuesta: 200 MB, configurable en Opciones). Debajo del umbral nada cambia.
El encabezado de la pestaña muestra una etiqueta «Archivo grande» con un tooltip que explica
qué funciona distinto.

`.gz` grandes: no admiten acceso por posición. Primera versión: se rechazan como hoy con un
mensaje que sugiere descomprimir. Más adelante: descomprimir a un temporal y abrirlo en este modo.

### 1. Índice de líneas (proceso principal)

Una pasada en streaming sobre el archivo construye:

- **Puntos de acceso:** el offset en bytes de cada bloque de 1 000 líneas
  (1 GB ≈ 10 000 puntos, unos KB). Para llegar a la línea N se salta al bloque y se leen
  las líneas restantes.
- **Resumen por bloque:** conteo de niveles, primera y última hora detectada. Da los totales de
  la barra de estado, el selector de días y el filtro de rango de horas sin releer el archivo.
- **Líneas partidas:** las líneas de más de 256K se cuentan como varias filas, igual que ahora,
  para que la numeración coincida con la vista normal.

La pasada informa progreso (bytes leídos) y se puede cancelar. Mientras indexa, la vista ya
puede mostrar las primeras filas.

### 2. Lectura por ventana

La lista virtual (`VirtualList.jsx`) ya dibuja solo lo visible. En este modo, en lugar de un
arreglo con todas las filas, pide rangos al proceso principal (`file:rows`, `{ from, count }`).
Este responde con `fs.read` desde el punto de acceso más cercano. La vista guarda un caché LRU
de ~50 000 filas clasificadas alrededor de la posición actual. Saltar al final o a una línea
concreta es inmediato.

### 3. Búsqueda y filtros

Se ejecutan en un worker del proceso principal recorriendo el archivo en streaming. Devuelven
**solo números de fila** que coinciden (arreglo compacto `Uint32Array`), con progreso y
cancelación. La vista filtrada es esa lista de índices, y sus filas se piden con el mismo
mecanismo de ventana.

- **Fase 1:** texto, regex (con el plazo de 2 s por bloque) y nivel.
- **Fase 2:** filtros encadenados, filtros extra, contexto (-C), búsquedas adicionales con color.
- Si una búsqueda supera, por ejemplo, 5 millones de coincidencias, se avisa y se ofrece afinarla.

### 4. Seguimiento en vivo

El seguimiento por offset (`watchFile`) ya existe. En este modo las líneas nuevas se agregan al
índice (nuevo bloque o el último ampliado) y se leen por ventana, así que **no crecen en
memoria**. Rotación, truncado y recreación se manejan igual que hoy: reindexar.

### 5. Qué se limita en este modo

| Función | Comportamiento |
|---|---|
| Combinar bitácoras | no disponible con un archivo grande; se avisa |
| Contexto para IA | solo filas filtradas o seleccionadas, con el tope actual de la IA |
| Exportar / copiar visible | por streaming a archivo; copiar al portapapeles con tope |
| Caché de archivos | no se cachea; el índice puede guardarse junto al caché, validado por tamaño y fecha |
| Marcas y selección | sin cambios: ya usan números de línea |

## Seguimiento prolongado: no agotar la RAM

Aplica a todos los modos, no solo al de archivo grande.

1. **Archivo local normal en vivo:** usar el mismo recorte que Docker y remoto
   (`appendRecentItems` con `maxLiveLines` y tope de bytes) en lugar de detenerse con
   `file_memory_limit`. Mostrar un aviso discreto: «Se descartaron las N filas más antiguas;
   recarga para verlas». Alternativa mejor cuando existe el modo archivo grande: al superar el
   tope, **pasar la pestaña a modo archivo grande** (el archivo sigue en disco, nada se pierde).
2. **Evitar la copia completa por lote:** sustituir `setClassified([...itemsRef.current])` por
   una estructura en bloques o un contador de versión, para que cada actualización cueste
   según lo nuevo y no según el total.
3. **Numeración estable al recortar:** las filas conservan su número original (`origLine`);
   marcas, selección y búsqueda que apunten a filas descartadas se eliminan o se marcan como
   «fuera de la ventana».
4. **Presupuesto global:** hoy cada pestaña tiene su tope, pero diez pestañas en vivo suman
   diez topes. Propuesta: un presupuesto de memoria total (p. ej. 1 GB, configurable), repartido
   entre las pestañas en vivo; la diagnóstica registra cuándo se recorta y cuánto.
5. **Diagnóstico:** registrar en la bitácora interna el uso de memoria por pestaña cada cierto
   tiempo, y avisar en la interfaz si `process.getProcessMemoryInfo()` supera un umbral.

## Remotos (SSH / WSL)

Sin cambios de comportamiento:

- Se leen las últimas N líneas (o N bytes) y se sigue en vivo con el recorte de
  `appendRecentItems`.
- «Archivo completo» solo si el tamaño remoto cabe en el presupuesto actual; si no, se
  ofrece leer las últimas líneas.
- Se aplica también el presupuesto global del punto 4.

## Fases y dificultad

| Fase | Contenido | Dificultad |
|---|---|---|
| 0 | Recorte en vivo para archivo local, aviso, lotes agrupados (hecho en 5.1.1) | Baja |
| 1 | Índice + lectura por ventana + saltos + totales por nivel | Media |
| 2 | Búsqueda y filtro por texto, regex y nivel en worker | Media |
| 3 | Seguimiento en vivo en modo grande, rotación | Media |
| 4 | Filtros encadenados, contexto, búsquedas extra, exportar en streaming | Alta |
| 5 | Presupuesto global de memoria y diagnóstico de memoria | Media |
| 6 | `.gz` grandes vía temporal, índice persistente | Media |

La fase 0 es independiente y resuelve ya el riesgo de dejar un archivo abierto mucho tiempo.

## Pruebas

- Archivo sintético de 1 GB y 10 millones de líneas, con líneas de más de 256K y CRLF.
- Medir memoria de la vista (objetivo < 500 MB) y tiempo de indexado.
- Saltar al inicio, al final y a una línea; buscar texto y regex; filtrar por nivel.
- Seguir en vivo escribiendo 10 000 líneas/s durante una hora: memoria estable.
- Rotar, truncar y recrear el archivo durante el seguimiento.
