# Propuesta: herramientas para el chat de IA y recomendación de modelo

Estado: planteamiento (sin implementar) · Fecha: 2026-11-17

## Contexto

El chat ya arma un contexto inteligente en cada pregunta (`buildContextSnapshot` en `src/aiChat.mjs`):

1. un resumen de todas las filas del alcance: niveles, rango de horas y mensajes más repetidos;
2. las filas que coinciden con lo que menciona la pregunta: IDs, IPs, horas y palabras poco comunes;
3. los errores y avisos con algunas líneas alrededor, mostrando cada mensaje repetido solo en su primera y última aparición;
4. las filas más recientes con el espacio que quede.

Esta propuesta cubre lo que queda fuera de eso.

## D. Que el modelo pida datos (tool calling)

Exponer herramientas que el modelo pueda llamar sobre el log completo:

| Herramienta | Qué hace |
|---|---|
| `buscar(regex, max)` | devuelve las filas que coinciden, con su número de línea |
| `ver_lineas(desde, hasta)` | devuelve un rango de filas |
| `contar(regex, agrupar_por?)` | cuenta coincidencias, por ejemplo por hora o por servicio |

**Por qué no ahora**
- Solo algunos modelos locales soportan herramientas en Ollama, y los pequeños suelen inventar llamadas o entrar en bucle.
- La búsqueda guiada por la pregunta (punto 2) ya cubre la mayoría de los casos sin depender del modelo.

**Cuándo tendría sentido**
- Preguntas de varios pasos ("¿qué pasó justo antes de cada timeout?").
- Si se usan modelos ≥14B o un proveedor con soporte de herramientas fiable.

**Diseño sugerido**
- Bucle con un límite de llamadas por pregunta (por ejemplo 5).
- Cada llamada se muestra en el chat.
- Las respuestas de las herramientas también pasan por `redactSecrets`.
- Si el modelo no declara soporte de herramientas, se desactiva.

## Recomendación de modelo

Para analizar logs pesa más **cuánto contexto real cabe** que el tamaño del modelo: un 7–8B con 32k suele responder mejor que un 14B limitado a 8k.

Criterios para que PulpLog recomiende:

1. **Memoria de vídeo o RAM disponible**: decide el tamaño y la cuantización que caben.
2. **Contexto efectivo**: la memoria que ocupa el contexto crece con `num_ctx`; hay que estimar si caben 32k o 64k junto al modelo.
3. **Calidad en español y en formato**: listas, tablas y citar números de línea.
4. **Soporte de herramientas**, si se hace D.

**Regla inicial propuesta**
- Priorizar la combinación de modelo y contexto que deje **≥32k tokens**.
- Con menos de 8 GB de memoria de vídeo: modelo pequeño con 16–32k antes que uno grande con 8k.
- Mostrar en Ajustes el contexto recomendado junto al modelo, no solo el nombre.

## Pendiente de medir

- El tiempo de armar el contexto con 500k filas es de unos 0,6–0,9 s en el hilo principal. Si molesta, se puede pasar al worker de filtrado.
- Probar con logs reales para ajustar los repartos de espacio (`MATCH_SHARE` = 35 %, `ISSUE_SHARE` = 30 %).
