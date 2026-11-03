# Publicar un release de PulpLog

Guía para generar los paquetes de Windows, preparar las capturas y publicar un
release en GitHub (`lindecode/PulpLog`). Los ejemplos usan la versión `4.0.1`;
sustitúyela por la versión que publiques.

## 1. Versión

1. Actualiza `version` en `package.json` y sincroniza `package-lock.json`:

   ```bash
   npm version 4.0.1 --no-git-tag-version
   ```

   La ventana **Acerca de** lee la versión de `package.json` al compilar
   (`__APP_VERSION__` en `vite.config.js`), así que no hay que tocarla.
2. Actualiza los nombres de ejemplo en el README (AppImage y `.deb`).
3. Haz commit de ambos archivos. Si `package-lock.json` queda fuera, el árbol
   del tag no coincide con el paquete publicado.

## 2. Verificación

```bash
npm test
npm run test:integration
```

## 3. Paquetes de Windows

```bash
npm run dist:win
```

electron-builder deja en `release/`:

| Archivo generado | Contenido |
|---|---|
| `PulpLog Setup 4.0.1.exe` | Instalador NSIS |
| `PulpLog-4.0.1-win.zip` | Aplicación sin instalar (portable) |

Los archivos que se publican tienen otro nombre y se preparan así (PowerShell,
desde la raíz del proyecto):

```powershell
$v = "4.0.1"
# Portable: el zip de electron-builder, renombrado.
Copy-Item "release\PulpLog-$v-win.zip" "release\PulpLog-Portable-$v-win.zip"
# Instalador: el .exe dentro de un zip sin compresión (ya viene comprimido).
Compress-Archive -Path "release\PulpLog Setup $v.exe" `
  -DestinationPath "release\PulpLog-Setup-$v-win.zip" -CompressionLevel NoCompression -Force
```

Resultado: `PulpLog-Setup-4.0.1-win.zip` y `PulpLog-Portable-4.0.1-win.zip`.

Los paquetes de macOS (`dmg`) y Linux (`AppImage`, `deb`) se generan con
`npm run dist:mac` y `npm run dist:linux` en cada sistema.

## 4. Capturas

Se adjuntan cinco capturas, con nombre `pulplog-<versión>-<n>.png`:

| n | Contenido | Sección de las notas |
|---|---|---|
| 1 | Log abierto con el tema LindeCode | Introducción |
| 2 | Diálogo **Bitácora remota** | Docker, SSH y WSL2 |
| 3 | Origen **Docker por SSH** | Docker, SSH y WSL2 |
| 4 | Panel **Análisis asistido** | Análisis con IA |
| 5 | **Configuración** | Personalización y Diagnóstico |

Si no cambió la interfaz, reutiliza las del release anterior y solo cámbiales
el número de versión en el nombre.

**Antes de publicar, difumina la información sensible.** Aunque el log sea de
ejemplo, revisa:

- Rutas locales: barra de origen del log y lista de archivos recientes en
  Configuración (usuario de Windows, OneDrive, nombre del equipo, proyectos).
- Hosts, URLs, tenants, IPs y usuarios dentro de las líneas del log.
- Alias SSH, rutas remotas y nombres de contenedores.

Para difuminar basta con un desenfoque fuerte por zonas, por ejemplo con
Pillow (`pip install pillow`):

```python
from PIL import Image, ImageFilter

im = Image.open("captura.png").convert("RGBA")
for box in [(56, 151, 986, 177)]:          # (x1, y1, x2, y2) en píxeles
    region = im.crop(box)
    for _ in range(3):
        region = region.filter(ImageFilter.GaussianBlur(9))
    im.paste(region, box)
im.save("pulplog-4.0.1-1.png")
```

Comprueba el resultado abriendo la imagen: que no quede texto legible y que la
zona no corte palabras vecinas.

## 5. Tag

El tag va sobre el commit desde el que se generaron los paquetes y se llama
`vX.Y.Z`, **sin punto después de la `v`**. La búsqueda de actualizaciones de la
app solo reconoce ese formato (`parseReleaseVersion` en `main.js`); con un tag
como `v.4.0.1` los usuarios no reciben el aviso.

```bash
git tag v4.0.1
git push origin main
git push origin v4.0.1
```

(También se puede hacer desde GitKraken.)

## 6. Release en GitHub

Con [GitHub CLI](https://cli.github.com/), desde la raíz del proyecto y con las
notas en `notes.md` (plantilla abajo):

```bash
gh release create v4.0.1 -R lindecode/PulpLog \
  --title "PulpLog v4.0.1" --notes-file notes.md --verify-tag --latest \
  release/PulpLog-Setup-4.0.1-win.zip release/PulpLog-Portable-4.0.1-win.zip \
  pulplog-4.0.1-1.png pulplog-4.0.1-2.png pulplog-4.0.1-3.png \
  pulplog-4.0.1-4.png pulplog-4.0.1-5.png
```

- Publícalo como **latest**, no como pre-release: la app consulta
  `releases/latest` para avisar de nuevas versiones.
- Las capturas se insertan en las notas con el enlace de descarga del propio
  release (`https://github.com/lindecode/PulpLog/releases/download/v4.0.1/pulplog-4.0.1-1.png`).
  Si alguna no se muestra en la página, edita el release y arrástrala al texto.

Comprobación final:

```bash
gh release view v4.0.1 -R lindecode/PulpLog --json isDraft,isPrerelease,assets
curl -s https://api.github.com/repos/lindecode/PulpLog/releases/latest | grep '"tag_name"'
```

Los tamaños de los zips deben coincidir con los de `release/` y `tag_name`
debe ser la versión nueva.

## Plantilla de notas

Sustituye `X.Y.Z` y completa **Cambios en esta versión** con lo que incluyen los
commits desde el tag anterior (`git log vANTERIOR..HEAD`). El resto describe la
aplicación completa y solo se cambia cuando cambian sus funciones.

````markdown
Visor de bitácoras para explorar archivos, seguir eventos en vivo y analizar errores desde una sola ventana.

PulpLog permite trabajar con archivos locales, contenedores Docker y servidores remotos por SSH. La aplicación está diseñada para Windows, macOS y Linux; los paquetes adjuntos en esta publicación corresponden a Windows.

![PulpLog con el tema LindeCode](https://github.com/lindecode/PulpLog/releases/download/vX.Y.Z/pulplog-X.Y.Z-1.png)

## Cambios en esta versión
- …

## Archivos y Seguimiento en Vivo
- Apertura de archivos `.log`, `.txt` y `.out`.
- Lectura de archivos comprimidos `.log.gz`, `.txt.gz` y `.out.gz`.
- Lectura por streams y renderizado de filas visibles para trabajar con bitácoras grandes.
- Seguimiento de nuevas líneas y detección de rotación, truncado o recreación del archivo.
- Acciones para limpiar la vista y mostrar únicamente lo nuevo, o recargar desde el origen.
- Pestañas, vistas divididas, archivos recientes y restauración de pestañas locales.

## Búsqueda e Inspección
- Búsqueda por texto o expresiones regulares, con navegación entre coincidencias.
- Búsquedas adicionales con resaltados de distintos colores.
- Filtros encadenados y filtrado por nivel de log.
- Filtro por rango de horas y selector de días detectados.
- Coloreado de niveles, fechas, excepciones y stack traces.
- Marcadores, selección de filas y navegación por teclado.
- Copia y exportación de resultados visibles o filas seleccionadas.

## Docker, SSH y WSL2
- Consulta y seguimiento de logs de contenedores Docker.
- Lectura de bitácoras remotas por SSH y dentro de distribuciones WSL2.
- Explorador de archivos remotos y lectura estática de archivos gzip.
- Autenticación con configuración SSH del sistema, agente, llaves privadas o usuario y contraseña.
- Verificación de la huella del servidor para conexiones con credenciales.
- Perfiles de conexión sin guardar contraseñas ni passphrases.
- Reconexión ante interrupciones temporales.
- Docker por SSH: selección de contenedores remotos y seguimiento de stdout y stderr, sin requerir Docker en el equipo local.

Las herramientas opcionales se validan según su disponibilidad y el sistema operativo.

![Bitácora remota](https://github.com/lindecode/PulpLog/releases/download/vX.Y.Z/pulplog-X.Y.Z-2.png)

![Docker por SSH](https://github.com/lindecode/PulpLog/releases/download/vX.Y.Z/pulplog-X.Y.Z-3.png)

## Análisis con IA
- Integración con Ollama y vLLM, en servidores locales o remotos.
- Configuración independiente de URLs y selección de modelos.
- Chat con respuestas en streaming, cancelación y formato Markdown.
- Análisis de filas seleccionadas o visibles, con presupuesto de contexto configurable.
- Opción para redactar posibles secretos del contexto.
- API key opcional (Bearer) para servidores compatibles con OpenAI, guardada cifrada con el almacén seguro del sistema.
- Preparación y copia de prompts para utilizarlos con otros asistentes.
- Reintentos automáticos cuando el servicio no está disponible o no ofrece modelos de chat.

La IA es opcional. PulpLog no instala motores ni descarga modelos; el servidor elegido debe estar en ejecución.

![Análisis asistido con IA](https://github.com/lindecode/PulpLog/releases/download/vX.Y.Z/pulplog-X.Y.Z-4.png)

## Personalización y Diagnóstico
- Interfaz en español e inglés.
- Temas LindeCode, Clásica, Blanca, Oscura, Brasa, Azul y Bosque.
- Tamaño de interfaz ajustable y preferencias de visualización.
- Bitácora interna para diagnosticar errores de conexión y funcionamiento.
- Manual integrado y consulta de nuevas versiones en GitHub Releases.

![Configuración](https://github.com/lindecode/PulpLog/releases/download/vX.Y.Z/pulplog-X.Y.Z-5.png)

## Seguridad
- Endurecimiento de los límites de seguridad entre la interfaz y el proceso principal, y límites para los flujos de datos.
- Dependencias actualizadas y revisión automática de dependencias con comprobaciones de seguridad multiplataforma.

## Descargas para Windows
- **Portable:** descomprime el ZIP y ejecuta PulpLog.
- **Instalador:** ejecuta el instalador y sigue sus indicaciones.

## Privacidad
Los archivos locales se procesan en el equipo. Al utilizar el chat de IA, las filas incluidas en el contexto y la conversación se envían al servidor configurado. La redacción de secretos es una ayuda, no una garantía: revisa los datos sensibles antes de enviarlos.

Consulta el [README](https://github.com/lindecode/PulpLog#readme) para ver requisitos, configuración de conexiones y preparación de los servidores de IA.
````
