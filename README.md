# PulpLog

PulpLog es un visor de logs de escritorio hecho con Electron, React y Vite. Está pensado para abrir archivos grandes, seguir logs en vivo, inspeccionar stack traces y conectarse rápidamente a logs de contenedores Docker.

Funciona en Windows, macOS y Linux.

## Requisitos

- Node.js 18+
- npm 9+
- Docker instalado y accesible desde la terminal, solo si vas a usar logs de contenedores
- OpenSSH (`ssh` y `ssh-add`) accesible desde la terminal, solo si vas a usar conexiones SSH automáticas
- WSL2, únicamente en Windows y solo para conexiones o archivos dentro de una distribución Linux

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
| Limpiar y recargar | `Limpiar` vacía sólo la vista actual para mostrar lo nuevo; `Recargar` vuelve a leer desde el origen |
| Restauración de sesión | Reabre las pestañas de archivos guardadas al iniciar la app |
| Archivos recientes | Guarda hasta 10 archivos recientes y permite reabrirlos desde bienvenida o configuración |

### Filtrado e inspección

| Función | Detalle |
|---------|---------|
| Filtro por texto | En tiempo real, sin distinguir mayúsculas/minúsculas |
| Filtro por regex | Botón `.*` con validación en vivo |
| Filtro por hora | Rango opcional con control de reloj (`HH:mm:ss`) y selector de día cuando el log trae fechas; las líneas continuadas heredan la última hora detectada |
| Filtro por nivel | Toggles para ERROR, WARN, INFO, DEBUG, TRACE, STACK y PLAIN. Ctrl+clic (Cmd+clic en macOS) aísla ese nivel; Ctrl+clic de nuevo restaura todos |
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

### SSH y WSL2

PulpLog puede seguir una bitácora remota mediante `tail -F`. La ventana **SSH / WSL** detecta las herramientas disponibles en el ordenador y sólo muestra WSL2 en Windows.

| Tipo de conexión | Uso recomendado |
|------------------|-----------------|
| SSH del sistema | Cuando `ssh alias` ya funciona en una terminal. Reutiliza OpenSSH, `~/.ssh/config`, llaves, aliases, SSH Agent y `ProxyJump` |
| SSH desde WSL2 | Windows ejecuta SSH dentro de la distribución elegida y usa su configuración y llaves Linux |
| SSH con credenciales | Solicita host, usuario y contraseña o una llave privada con passphrase |
| WSL2 local | Abre un log dentro de una distribución instalada, sin conectarse a otro servidor |

#### SSH config y aliases

PulpLog lee automáticamente los bloques `Host` de:

- Windows: `%USERPROFILE%\.ssh\config`
- Linux y macOS: `~/.ssh/config`
- SSH desde WSL2: `~/.ssh/config` dentro de la distribución seleccionada

Los aliases aparecen en un selector. También se puede escribir un host manualmente. Las entradas genéricas, por ejemplo `Host *`, no aparecen como destinos seleccionables, pero OpenSSH continúa aplicándolas.

```ssh-config
Host produccion
    HostName servidor.ejemplo.com
    User operador
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ProxyJump bastion
```

Para **SSH del sistema**, deja vacíos Usuario, Puerto, Llave y Servidor intermedio si quieres que sus valores provengan completamente del alias seleccionado.

#### SSH Agent

La ventana muestra el estado del agente como información:

- Verde: agente activo con llaves cargadas.
- Ámbar: agente activo sin llaves.
- Rojo: agente no detectado.

PulpLog no inicia, detiene ni modifica servicios del sistema. La ayuda integrada permite copiar estos comandos:

Windows / PowerShell:

```powershell
Start-Service ssh-agent
ssh-add $env:USERPROFILE\.ssh\id_ed25519
ssh-add -l
ssh-add -D
Stop-Service ssh-agent
```

Linux / WSL2:

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
ssh-add -l
ssh-add -D
ssh-agent -k
```

En macOS se puede cargar una llave en el llavero con:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

#### Contraseñas, passphrases y huella del servidor

**SSH del sistema** es una conexión no interactiva: si una llave cifrada requiere passphrase, debe estar previamente cargada en el agente. Para introducir usuario/contraseña o una llave con passphrase directamente en PulpLog, utiliza **SSH con credenciales**.

La primera conexión manual detecta la huella SHA256 del servidor. Verifícala con el administrador o por otro medio confiable antes de marcarla como aceptada. La confianza se aplica sólo a esa sesión.

Las contraseñas y passphrases:

- No se guardan en perfiles, ajustes ni restauración de sesión.
- No se escriben en la bitácora interna.
- No se pasan como argumentos de procesos ni variables de entorno.
- Permanecen en memoria únicamente mientras la conexión activa las necesita.

#### Reconexión

Las interrupciones temporales se reintentan automáticamente con espera progresiva. Ante una desconexión también aparece **Reconectar**. Si el error requiere contraseña, passphrase o nueva autenticación, **Configurar y reconectar** abre nuevamente la ventana con los datos no secretos y solicita otra vez las credenciales.

#### Historial inicial y límites

Al abrir una bitácora remota se puede elegir entre 500 o 5,000 líneas, los últimos 10 o 50 MB, o el archivo completo con un máximo de 100 MB. El proceso principal valida un límite absoluto de 200 MB aunque la interfaz sea manipulada. Si el archivo completo supera el límite elegido, se cargan sólo sus últimos bytes, se descarta cualquier primera línea incompleta y se muestra el tamaño real junto al recorte aplicado. Durante una carga por tamaño, la pestaña muestra el porcentaje recibido y clasifica los registros en un Web Worker con lotes limitados para mantener la interfaz disponible.

El límite de líneas vivas configurado en PulpLog continúa protegiendo la memoria. Las reconexiones siguen únicamente contenido nuevo y no vuelven a transferir el historial inicial.

### Configuración y diagnóstico

| Función | Detalle |
|---------|---------|
| Idioma | Interfaz en español o inglés |
| Tema | Clásica, Blanca, Oscura, Brasa (fuego/carmesí) o Azul (oscuro, tonalidad azul) |
| Preferencias | Auto-scroll por defecto y números de línea por defecto |
| Bitácora interna | Panel de diagnóstico con eventos de archivos, Docker y atajos |
| Acerca de | Modal con información de la app, autor y licencia |

### Integración de escritorio

| Función | Detalle |
|---------|---------|
| Asociación de archivos | Soporte para abrir `.log`, `.out` y `.txt` desde el sistema operativo |
| Instancia única | Si ya hay una ventana abierta, los archivos nuevos se abren ahí |
| Menú nativo | Abrir archivo, nueva pestaña, recargar, DevTools, zoom y pantalla completa |
| Manual de usuario | Menú Ayuda → Manual de usuario (`F1`): resumen de funciones y atajos, en el idioma activo |
| Atajos de pestañas | `Ctrl+W` / `Cmd+W` cierra la pestaña activa; `Ctrl+Shift+T` / `Cmd+Shift+T` reabre la última pestaña cerrada |
| Atajos globales | `Super+A` abre archivo, `Super+T` nueva pestaña, `Super+W` cierra pestaña, `Super+Shift+T` reabre la última pestaña y `Super+P` trae la app al frente |

En Windows 11 algunos atajos con `Super` pueden estar reservados por el sistema. La bitácora interna indica cuáles se registraron correctamente.

## Uso rápido

- `Ctrl+O`: abrir archivo
- `Ctrl+T`: nueva pestaña
- `Ctrl+W` (`Cmd+W` en macOS): cerrar pestaña
- `Ctrl+Shift+T` (`Cmd+Shift+T` en macOS): reabrir pestaña cerrada
- `F2`: siguiente marcador
- `Shift+F2`: marcador anterior
- `Space`: marcar/desmarcar la línea seleccionada
- Ctrl+clic en un badge de nivel (`Cmd+clic` en macOS): aislar ese nivel; Ctrl+clic de nuevo restaura todos
- Clic en `◇`: marcar línea
- Botón Docker: conectar a un contenedor activo
- Botón SSH / WSL: abrir una bitácora remota o dentro de WSL2
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
