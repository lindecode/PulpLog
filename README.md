# PulpLog

PulpLog es un visor de logs de escritorio hecho con Electron, React y Vite. Está pensado para abrir archivos grandes, seguir logs en vivo, inspeccionar stack traces y conectarse rápidamente a logs de contenedores Docker.

Funciona en Windows, macOS y Linux.

## Instalación para usuarios

Descarga el paquete correspondiente desde
[GitHub Releases](https://github.com/lindecode/PulpLog/releases). En Windows el
instalador NSIS permite elegir la carpeta de instalación y también se publica un
ZIP; en macOS se genera un DMG y en Linux un AppImage y un paquete DEB.

PulpLog no necesita Docker, OpenSSH ni WSL2 para abrir archivos locales. Esas
herramientas sólo son necesarias para la integración correspondiente.

## Requisitos

- Node.js 18+
- npm 9+
- Docker instalado y accesible desde la terminal, solo si vas a usar logs de contenedores
- OpenSSH (`ssh` y `ssh-add`) accesible desde la terminal, solo si vas a usar conexiones SSH automáticas
- WSL2, únicamente en Windows y solo para conexiones o archivos dentro de una distribución Linux
- Un servidor Ollama o vLLM accesible, sólo para el chat de IA; puede ejecutarse en otro equipo

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

## Pruebas

```bash
npm test                 # pruebas unitarias con node:test
npm run test:integration # smoke test de Electron
npm run build            # valida el bundle de producción
```

El smoke test necesita un entorno capaz de abrir Electron; en servidores sin
sesión gráfica puede requerir una pantalla virtual.

## Funcionalidades

### Lectura de logs

| Función | Detalle |
|---------|---------|
| Archivos grandes | Lectura por streams en chunks de 1 MB con progreso en tiempo real |
| Archivos comprimidos | Abre `.log.gz`, `.txt.gz`, `.out.gz` y `.gz` como lectura estática |
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
| Filtros encadenados | Un filtro principal y hasta 3 filtros adicionales; cada filtro reduce el resultado producido por el anterior |
| Búsquedas simultáneas | Una búsqueda principal navegable y hasta 3 resaltados adicionales con colores distintos; cada búsqueda admite texto o regex |
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

### Análisis con IA: Ollama y vLLM

La IA es opcional: PulpLog funciona como visor sin instalar motores ni modelos.
Para analizar bitácoras, se conecta a un servidor externo al proceso de PulpLog,
que puede estar en el mismo equipo o en otra máquina:

```text
PulpLog -> API HTTP/HTTPS -> Ollama o vLLM -> modelo -> CPU/GPU del servidor
```

PulpLog no instala ni inicia el motor, no descarga modelos y no busca archivos
de modelos en el disco. Consulta los que ofrece el servidor elegido.

#### Proveedores y modelos

En **Configuración > Proveedor de IA**, selecciona **Ollama** o **vLLM**. Cada
proveedor conserva su URL y modelo preferido de forma independiente.

| Proveedor | URL local predeterminada | Detección y chat |
|-----------|--------------------------|-----------------|
| Ollama | `http://127.0.0.1:11434` | `/api/tags`, `/api/show` y `/api/chat` |
| vLLM | `http://127.0.0.1:8000/v1` | `/models` y `/chat/completions` sobre la URL base |

Se admiten otros modelos de conversación que soporte cada motor; no hay una
lista cerrada en PulpLog. Estos son ejemplos para preparar el entorno:

| Modelo | Proveedor | Ejemplo de uso |
|--------|-----------|----------------|
| [`qwen2.5-coder:1.5b`](https://ollama.com/library/qwen2.5-coder:1.5b) | Ollama | Primera prueba con un modelo de menor tamaño |
| [`qwen2.5-coder:7b-instruct`](https://ollama.com/library/qwen2.5-coder:7b-instruct) | Ollama | Pruebas de análisis de código, errores y stack traces |
| [`Qwen/Qwen2.5-Coder-7B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct) | vLLM | Servidor de conversación para análisis técnico |

Los nombres de Ollama y los identificadores de Hugging Face no son intercambiables.
Elige en PulpLog el nombre que publique tu servidor. Un modelo de embeddings no
sirve para conversar. El consumo de RAM/VRAM depende del modelo, su cuantización,
el contexto y las solicitudes simultáneas; el tamaño descargado no equivale a la
memoria necesaria. Los ejemplos no garantizan compatibilidad con cualquier equipo.

#### Preparar Ollama

Obtén Ollama desde su [sitio oficial](https://ollama.com/download). Si no está
ejecutándose en segundo plano, inicia el servidor en una terminal:

```bash
ollama serve
```

Déjala abierta. En otra terminal descarga un modelo y comprueba el listado:

```bash
ollama pull qwen2.5-coder:1.5b
ollama list
```

Para usar el modelo de 7B, sustituye el nombre por `qwen2.5-coder:7b-instruct`.
No necesitas mantener `ollama run` abierto: PulpLog utiliza la API del servidor.
Si `ollama serve` indica que el puerto está ocupado, comprueba si Ollama ya está
activo antes de iniciar una segunda instancia.

Puedes comprobar la API desde PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

O desde Linux/macOS:

```bash
curl http://127.0.0.1:11434/api/tags
```

Consulta la [referencia de comandos de Ollama](https://docs.ollama.com/cli).

#### Ollama sin instalador en Windows

La [distribución independiente de Ollama para Windows](https://docs.ollama.com/windows)
permite usar el ZIP oficial con el ejecutable y sus bibliotecas, sin registrar un
servicio del sistema. Conserva las bibliotecas del paquete y verifica las
dependencias de GPU de tu equipo.

Desde la carpeta donde descomprimiste el paquete, ejecuta en PowerShell:

```powershell
$env:OLLAMA_HOST = "127.0.0.1:11434"
$env:OLLAMA_MODELS = Join-Path (Get-Location) "models"
.\ollama.exe serve
```

En otra terminal situada en esa carpeta:

```powershell
$env:OLLAMA_HOST = "127.0.0.1:11434"
.\ollama.exe pull qwen2.5-coder:1.5b
.\ollama.exe list
```

`OLLAMA_MODELS` debe configurarse en el proceso del servidor **antes** de arrancarlo.
La carpeta puede estar en otra ubicación; conserva su estructura completa de
modelos y manifiestos al trasladarla. Un archivo `.gguf` suelto no se registra
automáticamente en Ollama ni en PulpLog.

Para trabajar sin Internet, prepara previamente los binarios, bibliotecas y
modelos. Las políticas del equipo deben permitir ejecutar esos programas.
Consulta cómo configurar rutas en la [FAQ de Ollama](https://docs.ollama.com/faq).

#### Preparar vLLM

PulpLog puede conectarse a vLLM desde Windows, macOS o Linux sin tenerlo instalado
localmente. El siguiente ejemplo prepara **el servidor** en Linux con GPU NVIDIA
compatible; en Windows, vLLM no tiene soporte nativo y requiere un entorno como
WSL2 compatible o un servidor remoto. Revisa los
[requisitos del backend y los controladores](https://docs.vllm.ai/en/stable/getting_started/installation/gpu/)
antes de instalarlo. Para otras GPU o CPU, sigue la instalación específica de ese backend.

Con [uv instalado](https://docs.astral.sh/uv/getting-started/installation/), crea
un entorno independiente siguiendo el
[inicio rápido de vLLM](https://docs.vllm.ai/en/stable/getting_started/quickstart/):

```bash
uv venv --python 3.12 --seed .venv-vllm
source .venv-vllm/bin/activate
uv pip install vllm --torch-backend=auto
vllm download-kernels
```

Inicia el modelo de ejemplo y deja el proceso activo:

```bash
vllm serve Qwen/Qwen2.5-Coder-7B-Instruct \
  --host 127.0.0.1 \
  --port 8000 \
  --max-model-len 8192
```

El primer arranque puede descargar los archivos del modelo. También puedes pasar
una ruta local con el modelo completo, su configuración y tokenizer, preparados
previamente. PulpLog no necesita conocer esa ruta.

Verifica que el servidor haya terminado de cargar:

```bash
curl http://127.0.0.1:8000/v1/models
```

En PowerShell usa `Invoke-RestMethod http://127.0.0.1:8000/v1/models`.
Consulta la [API compatible de vLLM](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/).
Si el servidor exige autenticación, configura su API key en PulpLog. Se envía
como `Authorization: Bearer ...` al consultar modelos y conversar. Esto también
sirve para Ollama detrás de un proxy que acepte autenticación Bearer; el servidor
local de Ollama normalmente no requiere clave.

#### API keys y prueba de conexión

En **Configuración**, elige el proveedor. Sólo se muestran su URL, API key y
opciones de almacenamiento. Puedes restablecer la URL local con el botón de
restablecer y usar **Probar conexión** para consultar los modelos disponibles.

Para agregar o sustituir una clave, escríbela en **API key (Bearer)** y pulsa
**Guardar clave** o **Guardar y probar**. La clave nueva permanece oculta salvo
que actives **Mostrar nueva clave**. Después de guardarla se vacía el campo:
la clave almacenada no se devuelve a la interfaz. **Eliminar clave** la borra.

**Recordar en este equipo** utiliza el cifrado de `safeStorage` de Electron y
guarda las credenciales fuera de los ajustes generales, en `ai-credentials.json`
dentro de los datos de usuario de la aplicación. Si no hay almacenamiento seguro
disponible, se conservan sólo en memoria durante la sesión; en Linux no se utiliza
el backend `basic_text` para guardarlas. Las claves cifradas no deben considerarse
portables entre usuarios o equipos.

Las claves se asocian tanto al proveedor como a la URL exacta del servidor.
Cambiar la URL no reenvía la clave guardada al nuevo destino: debes configurarla
para ese destino. No se incluyen en URLs, ajustes generales ni exportaciones;
los errores de las solicitudes ocultan la clave utilizada. Cambiar una clave
reinicia el contexto del panel de IA. Para servidores remotos, utiliza HTTPS
o un túnel SSH: una clave Bearer no cifra el tráfico.

#### Conectar y analizar desde PulpLog

1. Abre **Configuración** y selecciona el proveedor de IA.
2. Configura su URL; pulsa Enter o sal del campo para guardarla. Para vLLM incluye
   el prefijo `/v1`; no agregues `/models` ni `/chat/completions` al campo.
3. Si requiere autenticación, guarda la API key y pulsa **Probar conexión**.
4. Abre una bitácora local, Docker o SSH y pulsa **IA**.
5. Selecciona un modelo del servidor y escribe una pregunta.
6. Para acotar el análisis, selecciona filas o aplica filtros antes de comenzar.

El chat utiliza las filas seleccionadas; si no hay selección, usa las visibles
según los filtros. El presupuesto de contexto puede recortar el contenido y da
prioridad a las filas más recientes. Usa **Contexto de IA (tokens)** para ajustar
el presupuesto; cuando el servidor anuncia el límite del modelo, PulpLog lo
respeta. En vLLM la capacidad del motor se configura en el servidor, por ejemplo
con `--max-model-len`; aumentar el ajuste de PulpLog no amplía esa capacidad.

Las respuestas se muestran en streaming y se pueden detener. Cambiar de proveedor
o de URL detiene la generación anterior e inicia una conversación nueva.

Al abrir el panel se comprueba el servicio. Si no responde o no ofrece modelos de
chat, se reintenta cada 10 segundos, sin consultas simultáneas. Los reintentos
se detienen al encontrar modelos disponibles o cerrar el panel. El botón de
actualizar permite repetir la consulta manualmente.

#### Servidor remoto y túnel SSH

`127.0.0.1` siempre se refiere al equipo donde se ejecuta PulpLog. Para un servidor
de otra máquina, configura una URL alcanzable o usa un túnel SSH. Por ejemplo,
si vLLM escucha en `127.0.0.1:8000` **en el servidor**, ejecuta en tu equipo:

```bash
ssh -N -L 18000:127.0.0.1:8000 usuario@servidor
```

Mantén la terminal abierta y configura vLLM en PulpLog como
`http://127.0.0.1:18000/v1`. Para Ollama, puedes usar
`ssh -N -L 11435:127.0.0.1:11434 usuario@servidor` y la URL
`http://127.0.0.1:11435`. El túnel se inicia externamente; no es una conexión
del selector de bitácoras SSH de PulpLog. Los modelos se ejecutan en el servidor,
sin requerir GPU ni archivos de modelos en el equipo del visor.

#### Errores habituales de IA

| Síntoma | Comprobación |
|---------|--------------|
| Servicio no disponible o `ECONNREFUSED` | Confirma que el proceso siga activo y que host, puerto y túnel sean correctos |
| No aparecen modelos en Ollama | Ejecuta `ollama list` contra el mismo servidor y descarga un modelo de chat |
| No aparecen modelos en vLLM | Espera a que termine de cargar y consulta `/v1/models` |
| HTTP 404 | Revisa proveedor y URL base; Ollama no usa el prefijo `/v1` de esta integración |
| HTTP 401 o 403 | Revisa la API key del proveedor, su vigencia y la URL a la que está asociada; se admite autenticación Bearer |
| Error de plantilla de chat | Comprueba que el modelo sea de conversación/Instruct y que vLLM tenga una plantilla compatible |
| Contexto excedido o falta de memoria | Reduce el contexto y las filas enviadas; revisa modelo, cuantización y capacidad del servidor |
| Puerto ocupado | Comprueba si ya existe un proceso activo o elige otro puerto y actualiza la URL |

Verificar los endpoints con los comandos anteriores ayuda a distinguir un error
del servidor de uno de configuración del visor. La ausencia de IA no impide
abrir, filtrar ni exportar bitácoras.

### SSH y WSL2

PulpLog puede seguir una bitácora remota mediante `tail -F`. Para archivos `.gz`, lee y descomprime con `gzip -cd` de forma estática. La ventana **SSH / WSL** detecta las herramientas disponibles en el ordenador y sólo muestra WSL2 en Windows.

| Tipo de conexión | Uso recomendado |
|------------------|-----------------|
| SSH del sistema | Cuando `ssh alias` ya funciona en una terminal. Reutiliza OpenSSH, `~/.ssh/config`, llaves, aliases, SSH Agent y `ProxyJump` |
| SSH desde WSL2 | Windows ejecuta SSH dentro de la distribución elegida y usa su configuración y llaves Linux |
| SSH con credenciales | Solicita host, usuario y contraseña o una llave privada con passphrase |
| WSL2 local | Abre un log dentro de una distribución instalada, sin conectarse a otro servidor |

Las rutas remotas `.gz` requieren que el host remoto, WSL2 o la distribución Linux tenga `gzip` disponible. Al ser archivos comprimidos cerrados, se muestran como una lectura puntual y no activan seguimiento en vivo.

#### Docker por SSH

En **SSH / WSL**, configura la conexion y selecciona **Origen > Docker por SSH**.
Pulsa **Consultar contenedores**, elige uno y abre sus logs. La consulta incluye
contenedores detenidos y permite cargar las ultimas 500 o 5000 lineas antes de
seguir las nuevas. Se muestran tanto stdout como stderr.

No requiere Docker instalado en el equipo local: el servidor remoto debe tener
Docker disponible y el usuario SSH debe poder consultarlo sin un prompt de sudo.
Funciona con SSH del sistema, SSH desde WSL2 y SSH con credenciales. Este ultimo
requiere verificar la huella del servidor antes de consultar contenedores.
Los perfiles guardan la conexion y el contenedor, pero no contrasenas ni passphrases.

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
| Tema | LindeCode (por defecto; color hueso con cabecera oscura, como lindecode.cloud), Clásica, Blanca, Oscura, Brasa (fuego/carmesí), Azul (oscuro, tonalidad azul) o Bosque (verde grisáceo) |
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
| Buscar actualizaciones | Menú Ayuda → Buscar actualizaciones consulta GitHub Releases, permite ocultar una versión y abre la descarga oficial si hay una versión nueva |
| Atajos de pestañas | `Ctrl+W` / `Cmd+W` cierra la pestaña activa; `Ctrl+Shift+T` / `Cmd+Shift+T` reabre la última pestaña cerrada |
| Atajos globales | `Super+A` abre archivo, `Super+T` nueva pestaña, `Super+W` cierra pestaña, `Super+Shift+T` reabre la última pestaña y `Super+P` trae la app al frente |

En Windows 11 algunos atajos con `Super` pueden estar reservados por el sistema. La bitácora interna indica cuáles se registraron correctamente.

## Privacidad y seguridad

- Los archivos locales se procesan en el equipo.
- Las contraseñas y passphrases SSH manuales se conservan sólo durante la
  conexión y no se guardan en perfiles ni en la restauración de sesión.
- El chat de IA envía las filas incluidas en el contexto, los metadatos del origen
  y la conversación al servidor Ollama o vLLM configurado. Si el servidor es remoto,
  esos datos salen del equipo; utiliza un destino autorizado y HTTPS o un túnel SSH.
- La opción de redactar posibles secretos se aplica localmente al contexto, pero
  no garantiza eliminar todos los datos sensibles. Revisa también lo que escribes
  manualmente en el chat.
- Preparar y copiar un prompt para otro asistente sólo lo lleva al portapapeles;
  esa acción no lo envía automáticamente a ningún modelo.
- **Buscar actualizaciones** consulta la API pública de GitHub Releases; PulpLog
  no descarga ni instala una actualización automáticamente.
- Docker, SSH y WSL ejecutan herramientas del sistema con los parámetros que
  proporciona el usuario. Verifica siempre el host y la ruta antes de conectar.

No agregues contraseñas, tokens, llaves privadas ni archivos `.env` al
repositorio. Para SSH, prefiere el agente del sistema o selecciona la llave desde
la interfaz.

## Solución rápida de problemas

| Problema | Comprobación |
|---|---|
| Docker no aparece | Ejecuta `docker ps` en la misma sesión del sistema |
| SSH automático falla | Prueba primero `ssh alias` en una terminal |
| Llave cifrada no abre | Cárgala con `ssh-add` o usa SSH con credenciales |
| WSL2 no aparece | Ejecuta `wsl --list --quiet` y comprueba que exista una distribución |
| El archivo no se actualiza | Confirma permisos, existencia y si fue rotado o recreado |
| La interfaz se ralentiza | Reduce el historial inicial o el límite de líneas vivas |

La bitácora interna de PulpLog muestra el detalle de detección, procesos y
reconexiones sin registrar contraseñas.

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

## Contribuir

Antes de enviar un cambio, ejecuta `npm test` y `npm run build`. Mantén la lógica
de procesamiento reutilizable en módulos pequeños, cubre los casos nuevos con
pruebas y no incluyas `release/`, `node_modules/`, configuraciones locales ni
archivos que puedan contener datos reales de logs.

## Licencia

PulpLog es desarrollado por [LindeCode](https://lindecode.cloud) y se distribuye
bajo la licencia [MIT](LICENSE).
