# PulpLog

PulpLog es un visor de logs de escritorio hecho con Electron, React y Vite. Está pensado para abrir archivos grandes, seguir logs en vivo, inspeccionar stack traces y conectarse rápidamente a logs de contenedores Docker.

Funciona en Windows, macOS y Linux.

## Requisitos

- Node.js 18+
- npm 9+
- Docker instalado y accesible desde la terminal, solo si vas a usar logs de contenedores

## Instalación y desarrollo

```bash
npm install
npm run dev
```

`npm run dev` levanta Vite y abre Electron automáticamente.

## Compilar instaladores

```bash
npm run dist          # plataforma actual
npm run dist:win      # .exe NSIS + portable
npm run dist:mac      # .dmg
npm run dist:linux    # .AppImage + .deb
```

Los instaladores se generan en `release/`.

## Funcionalidades

### Lectura de logs

| Función | Detalle |
|---------|---------|
| Archivos grandes | Lectura por streams en chunks de 1 MB con progreso en tiempo real |
| Virtual scroll | Renderiza solo las filas visibles para mantener fluidez con muchos registros |
| Pestañas | Abre varios archivos o streams en la misma ventana |
| Auto-scroll | Sigue automáticamente el final del archivo cuando está activo |
| Restauración de sesión | Reabre las pestañas de archivos guardadas al iniciar la app |
| Archivos recientes | Guarda hasta 10 archivos recientes y permite reabrirlos desde bienvenida o configuración |

### Filtrado e inspección

| Función | Detalle |
|---------|---------|
| Filtro por texto | En tiempo real, sin distinguir mayúsculas/minúsculas |
| Filtro por regex | Botón `.*` con validación en vivo |
| Filtro por nivel | Toggles para ERROR, WARN, INFO, DEBUG, TRACE, STACK y PLAIN |
| Coloreado semántico | Resalta niveles de log, timestamps, paquetes Java, stack frames y `Caused by:` |
| Marcadores | Clic en el número de línea para marcar/desmarcar |
| Navegación de marcadores | Botones para saltar al marcador anterior o siguiente |

### Tail -f y rotación

| Evento | Comportamiento |
|--------|----------------|
| Nuevas líneas | Se agregan al final mientras el seguimiento está activo |
| Archivo rotado | Muestra aviso y recarga automáticamente |
| Archivo truncado | Detecta `copytruncate`, avisa y recarga |
| Archivo recreado | Reanuda el seguimiento cuando vuelve a existir |

### Docker

| Función | Detalle |
|---------|---------|
| Lista de contenedores | Muestra contenedores Docker en ejecución |
| Stream de logs | Abre una pestaña con `docker logs --follow --tail=500` |
| Filtros y marcadores | Los logs de Docker usan las mismas herramientas de búsqueda, niveles y marcadores |
| Diagnóstico de errores | Informa si Docker no está corriendo o no es accesible |

### Configuración y diagnóstico

| Función | Detalle |
|---------|---------|
| Idioma | Interfaz en español o inglés |
| Preferencias | Auto-scroll por defecto y números de línea por defecto |
| Bitácora interna | Panel de diagnóstico con eventos de archivos, Docker y atajos |
| Acerca de | Modal con información de la app, autor y licencia |

### Integración de escritorio

| Función | Detalle |
|---------|---------|
| Asociación de archivos | Soporte para abrir `.log`, `.out` y `.txt` desde el sistema operativo |
| Instancia única | Si ya hay una ventana abierta, los archivos nuevos se abren ahí |
| Menú nativo | Abrir archivo, nueva pestaña, recargar, DevTools, zoom y pantalla completa |
| Atajos globales | `Super+A` abre archivo, `Super+T` nueva pestaña, `Super+W` cierra pestaña, `Super+Shift+T` reabre la última pestaña y `Super+P` trae la app al frente |

En Windows 11 algunos atajos con `Super` pueden estar reservados por el sistema. La bitácora interna indica cuáles se registraron correctamente.

## Uso rápido

- `Ctrl+O`: abrir archivo
- `Ctrl+T`: nueva pestaña
- `F2`: siguiente marcador
- `Shift+F2`: marcador anterior
- Clic en `◇`: marcar línea
- Botón Docker: conectar a un contenedor activo
- Botón de bitácora: revisar eventos internos de la app
- Botón de configuración: idioma, recientes y preferencias

## Icono de la app

Coloca los iconos en `assets/`:

- `icon.ico`: Windows, 256x256
- `icon.icns`: macOS
- `icon.png`: Linux, 512x512

Actualmente la configuración de build usa `assets/icon.png` como icono principal.

## Estructura

```text
pulplog/
├── main.js          # proceso principal: ventana, IPC, fs.watch, Docker, settings y atajos globales
├── preload.js       # contextBridge entre Electron y React
├── vite.config.js
├── package.json     # scripts, build y asociaciones de archivo
├── assets/
│   └── icon.png
└── src/
    ├── index.html
    ├── main.jsx
    └── App.jsx      # UI: pestañas, virtual scroll, filtros, Docker, settings y diagnóstico
```
