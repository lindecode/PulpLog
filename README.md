# LogViewer Desktop

Visor de logs de escritorio — Electron + React + Vite. Cross-platform: Windows, macOS, Linux.

## Requisitos

- Node.js 18+
- npm 9+

## Instalación y desarrollo

```bash
npm install
npm run dev        # abre Vite + Electron simultáneamente
```

## Compilar instalador

```bash
npm run dist          # plataforma actual
npm run dist:win      # → .exe (NSIS) + portable
npm run dist:mac      # → .dmg
npm run dist:linux    # → .AppImage + .deb
```

Los instaladores quedan en `release/`.

## Características

### Filtrado
| Feature | Detalle |
|---------|---------|
| Filtro por texto | En tiempo real, case-insensitive |
| **Filtro por regex** | Botón `.*` activa modo regex con validación en vivo |
| Filtro por nivel | Badges de toggle: ERROR / WARN / INFO / DEBUG / TRACE / STACK / PLAIN |

### Marcadores (Bookmarks)
| Acción | Cómo |
|--------|------|
| Marcar/desmarcar línea | Clic en el número de línea (◇ → ◆) |
| Saltar al siguiente marcador | Botón **◆ ↓** |
| Saltar al marcador anterior | Botón **◆ ↑** |
| Limpiar todos | Botón **✕ marcas** (aparece cuando hay al menos uno) |
| Indicador visual | Fondo dorado + barra lateral amarilla en líneas marcadas |

### Tail -f y rotación de logs
| Evento | Comportamiento |
|--------|---------------|
| Nuevas líneas | Appended instantáneamente al final |
| **Archivo rotado** (rename) | Banner ámbar + recarga automática en 3 s |
| **Archivo truncado** (copytruncate) | Banner azul + recarga automática en 2 s |
| **Archivo recreado** | Banner verde + recarga inmediata + reanuda watch |
| Auto-scroll | Sigue el final del archivo en modo tail |

### Rendimiento
| Feature | Detalle |
|---------|---------|
| Virtual scroll | Solo ~80 filas en DOM, sin importar el tamaño |
| Lectura en streams | Chunks de 1 MB, barra de progreso en tiempo real |
| useMemo en clasificación y filtrado | Recalcula solo cuando cambia el contenido |

### Coloreado
| Tipo | Color |
|------|-------|
| ERROR / Exception | Rojo oscuro + barra roja |
| WARN | Ámbar oscuro |
| INFO | Azul oscuro |
| DEBUG | Verde apagado |
| TRACE | Gris oscuro |
| Stack frame (`at …`) | Violeta |
| `Caused by:` | Naranja |

## Icono de la app

Coloca tus iconos en `assets/`:
- `icon.ico` — Windows (256×256)
- `icon.icns` — macOS
- `icon.png` — Linux (512×512)

## Estructura

```
logviewer-desktop/
├── main.js          ← proceso principal (Node.js): ventana, IPC, fs.watch, rotación
├── preload.js       ← contextBridge: Node ↔ React
├── vite.config.js
├── package.json
└── src/
    ├── index.html
    ├── main.jsx
    └── App.jsx      ← toda la UI: tabs, virtual scroll, regex, bookmarks, rotación
```
