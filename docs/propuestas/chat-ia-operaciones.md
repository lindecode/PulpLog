# Chat de IA: operaciones calculadas por PulpLog

Estado: implementado (`src/logOps.mjs`, `src/aiPlanner.mjs`) · Fecha: 2026-11-17

## Idea

Un modelo local pequeño (2–8B) no puede contar, recorrer ni comparar decenas de miles de
líneas. PulpLog sí. Por eso **PulpLog calcula datos exactos sobre el alcance completo y el
modelo solo los interpreta**.

Flujo de cada pregunta:

1. **Reglas**: patrones en español e inglés detectan las preguntas más comunes ("todos los
   errores", "picos", "línea 1234", "cuántas veces"…). Son instantáneas y deterministas.
2. **Planificador** (solo si ninguna regla aplica): una llamada corta pide al modelo un JSON
   con las operaciones a ejecutar. Elegir entre unas pocas opciones es algo que un modelo
   de 4B hace bien. Si el JSON no es válido, se sigue sin operaciones.
3. **Ejecución**: PulpLog corre las operaciones sobre todas las filas del alcance.
4. **Respuesta**: el modelo recibe los resultados exactos más el contexto inteligente
   (resumen + coincidencias + errores + recientes) y responde.
5. **En el chat**, los resultados exactos se muestran tal cual, encima de la respuesta del
   modelo, con números de línea en los que se puede hacer clic. Así "dime todos los errores"
   es completo aunque el modelo resuma mal.

## Operaciones

| Operación | Qué calcula | Preguntas típicas |
|---|---|---|
| `catalog` | Mensajes de error/aviso distintos (agrupando las partes variables): veces, primera y última hora, línea de ejemplo | "dime todos los errores", "¿qué avisos hay?" |
| `timeline` | Conteo por tramo de tiempo (tamaño automático) por nivel, con picos detectados (media + 2σ) | "¿hay picos?", "¿cuándo empezó?" |
| `search` | Coincidencias de términos o regex, con rango de horas y nivel opcionales; total exacto y una muestra repartida | "¿qué pasó con el pedido 4821?" |
| `count` | Cuántas filas coinciden y cómo se reparten en el tiempo | "¿cuántas veces se sincronizó?" |
| `context` | Las filas alrededor de una línea | "¿qué pasó antes de la línea 33972?" |
| `compare` | Mensajes de error/aviso antes y después de una hora o línea: nuevos, desaparecidos, cambios | "¿qué cambió después de las 17:18?" |
| `top` | Valores más frecuentes: `clave=valor`, IPs, rutas HTTP, loggers, hilos (opcionalmente solo en errores) | "¿qué usuario genera más errores?" |
| `sources` | Filas y errores por bitácora en una pestaña combinada | "¿cuántas bitácoras hay?" |

## Límites conocidos

- El razonamiento causal sigue dependiendo del tamaño del modelo.
- Las operaciones de tiempo necesitan marcas de tiempo en las líneas; si no las hay, se indica.
- Las ideas de embeddings y de resumen por trozos siguen en
  [chat-ia-herramientas-y-modelo.md](chat-ia-herramientas-y-modelo.md).
