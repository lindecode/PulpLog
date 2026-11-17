# Propuesta: vista de tabla para bitácoras

Estado: planteamiento (sin implementar) · Fecha: 2026-11-17

## Objetivo

Mostrar una bitácora como tabla con columnas (hora, nivel, origen, mensaje…) para poder
ordenar, ocultar columnas y, más adelante, filtrar por columna y exportar.

## Dificultad estimada

Media. La lista virtualizada, el filtrado en worker para 500k líneas y la detección de hora
y nivel ya existen. Lo nuevo y delicado es extraer columnas de texto libre.

## Qué se reutiliza

| Pieza | Dónde | Uso en la tabla |
|---|---|---|
| Hora | `parseTimestampFromText` (`src/logProcessing.mjs`) | columna Hora y orden por fecha |
| Nivel | `classify` (`src/logProcessing.mjs`) | columna Nivel (incluye JSON pino/winston y `[level]`) |
| Origen | prefijo `[archivo]` de las pestañas combinadas (`src/mergedSource.mjs`) | columna Origen |
| Multilínea | detección de continuaciones (stack traces) | agrupar continuaciones bajo su entrada |
| Virtualización | `src/components/VirtualList.jsx` | dibujar solo las filas visibles |
| Filtros | `filterLogs` + worker | se aplican antes de ordenar, sin cambios |

## Qué hay que construir

### 1. Extracción de columnas

Detectar el formato con una muestra de las primeras ~200 líneas:

| Formato | Columnas | Dificultad |
|---|---|---|
| JSON por línea | todas las claves (`time`, `level`, `msg`, `service`…) | baja |
| logfmt (`key=value`) | todas las claves | baja |
| Patrones conocidos (Log4j/Logback, nginx/Apache, syslog, Docker) | hora, nivel, hilo, logger, mensaje | media |
| Texto libre (respaldo) | hora, nivel, mensaje | ya existe |

Opcional más adelante: patrón definido por el usuario (regex con grupos con nombre).

### 2. Entradas multilínea

Cada fila de la tabla es una entrada con sus líneas de continuación, expandible.
Al ordenar se mueve la entrada completa.

### 3. Ordenar

- En el worker, para no bloquear la interfaz con 500k filas.
- Orden por defecto: el original del archivo, con opción de volver a él.
- Comparación según el tipo de columna: fecha, número o texto.

### 4. Seguimiento en vivo con orden activo

Si el orden no es por hora, las líneas nuevas caen en cualquier posición. Propuesta:
con un orden distinto al de la hora, pausar el autoscroll y mostrar un aviso
"N líneas nuevas · reordenar".

### 5. Interfaz

- Botón para pasar entre la vista de texto y la de tabla, por pestaña.
- Encabezados en los que se hace clic para ordenar; columnas redimensionables; elegir cuáles se muestran.
- Copiar desde la tabla como texto original o como TSV.

## Fases

1. **MVP**: modo tabla con columnas fijas (hora, nivel, origen, mensaje), multilínea agrupada y orden en worker.
2. **Columnas dinámicas**: detección de JSON y logfmt; elegir u ocultar columnas.
3. **Avanzado**: patrones conocidos y regex personalizada, filtro por columna y exportar CSV.

## Preguntas abiertas

1. ¿Qué formatos de log se usan más (JSON, Log4j/Spring, nginx, Docker…)? Decide si la fase 2 va antes que la 1.
2. ¿La tabla aplica a todo (archivos, Docker, SSH, combinadas) o empezamos con archivos locales y combinadas?
3. Con orden activo y líneas nuevas llegando: ¿pausa con aviso para reordenar u otro comportamiento?
4. ¿Ordenar es lo principal, o también agrupar o contar (por ejemplo, errores por servicio)?
