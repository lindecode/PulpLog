# Propuesta: rediseño de SSH y WSL

Estado: planteamiento · Fases 0, 1 y 4 implementadas · Fecha: 2026-11-18

## 1. Situación actual

El botón **SSH / WSL** abre un diálogo con cuatro modos:

| | SSH del sistema | SSH directo (`ssh2`) | SSH desde WSL | WSL local |
|---|---|---|---|---|
| Contraseña del servidor | ❌ `BatchMode=yes` | ✅ con bóveda | ❌ `BatchMode=yes` | — |
| Contraseña interactiva / 2FA | ❌ | ❌ `tryKeyboard:false` | ❌ | — |
| Llave con passphrase | solo cargada en el agente | ✅ solo para la sesión | solo con el agente de WSL | — |
| SSH Agent | ✅ Windows | ❌ | ✅ WSL | — |
| `~/.ssh/config` y alias | ✅ | ❌ | ✅ WSL | — |
| ProxyJump | ✅ texto libre | ❌ | ✅ texto libre | — |
| Logs de root (`sudo`) | ❌ | ❌ | ❌ | ❌ |
| Huella del servidor | se acepta sola (`accept-new`) | se confirma | se acepta sola | — |

Problemas:

1. Elegir modo obliga a escoger entre **contraseña** y **alias, agente y ProxyJump**.
2. SSH directo falla en servidores que piden la contraseña de forma interactiva (PAM, 2FA).
3. No se pueden leer logs protegidos (`syslog`, `auth.log`, nginx).
4. **Fallo corregido en la fase 0:** con `-J`, las opciones `-o` solo llegaban al destino
   (`man ssh`, opción `-J`); el bastion corría sin `BatchMode`, `ConnectTimeout` ni keepalive.
5. Un perfil mezcla servidor, credenciales y archivo: cinco logs de un mismo servidor son
   cinco perfiles con las credenciales repetidas.
6. La construcción de argumentos de `ssh` estaba triplicada (stream, listado y prueba).

## 2. Principios

- **Un solo concepto de "SSH"**. El motor es un detalle interno.
- **Definir una vez, reutilizar**: el servidor con sus credenciales y saltos; las bitácoras debajo.
- **Las credenciales no salen de tu equipo**: túnel en lugar de reenvío del agente; secretos
  solo en memoria o en la bóveda cifrada; nunca en la línea de comandos ni en archivos.
- **Errores que dicen dónde**: qué salto, qué paso (red, huella, autenticación, permiso del archivo).
- **Nada de lo actual se pierde**: los perfiles se migran solos.

## 3. Modelo: servidores y bitácoras

```
Servidor  (se define una vez)
 ├─ nombre, entorno (prod / staging / dev) y color
 ├─ destino: alias de ~/.ssh/config o usuario@host:puerto
 ├─ cadena de saltos (sección 5)
 ├─ autenticación (sección 4)
 ├─ configuración SSH de: Windows | WSL <distro>
 └─ opciones: zona horaria, codificación, sudo, timeout, reconexión
      │
      └─ Bitácoras (varias por servidor)
          ├─ Archivo: /var/log/app.log   (patrones *.log)
          ├─ Contenedor Docker remoto: web-1 (por nombre)
          ├─ journalctl: -u nginx
          └─ Comando personalizado (con advertencia)
          + historial inicial y "leer como root" por bitácora
```

## 4. Conexión y autenticación

### Motor
- **SSH del sistema siempre que exista** (Windows o WSL): respeta config, alias, agente y saltos.
- **Motor directo (`ssh2`) solo si no hay cliente `ssh`**. Debe soportar también saltos
  (encadenando `forwardOut`) y contraseña interactiva.

### Métodos de autenticación (visibles, sin "avanzado")

| Método | Cómo |
|---|---|
| Agente / llave | Agente de Windows o de WSL según la configuración elegida; llave opcional por archivo |
| Contraseña | Guardada en la bóveda (cifrada) o solo para la sesión |
| Preguntar al conectar | PulpLog muestra un diálogo cuando el servidor pide algo (contraseña, passphrase, código 2FA) |

### Contraseña con el SSH del sistema: `SSH_ASKPASS`
- Solo cuando hay contraseña: se quita `BatchMode` y se definen `SSH_ASKPASS` (PulpLog en un modo
  auxiliar) y `SSH_ASKPASS_REQUIRE=force`.
- El auxiliar pide el secreto a PulpLog por un canal local de un solo uso (pipe con token);
  nunca va en argumentos, variables de entorno visibles ni archivos.
- OpenSSH incluye en la petición el host (`deploy@prod-api's password:`): así PulpLog sabe a
  qué salto corresponde cada contraseña.
- Peticiones desconocidas (2FA, "Verification code") → diálogo al usuario.
- En WSL el auxiliar es un script mínimo que habla con el mismo canal.
- **Pendiente de verificar**: que el `ssh` de Windows (9.5) respeta `SSH_ASKPASS_REQUIRE`.

### Huella del servidor
- Igual para todos los motores: la primera vez se muestra la huella de **cada** servidor de la
  cadena y se confirma; después se compara. Cambio de huella → error claro, nunca aceptar en silencio.

## 5. Cadena de saltos

### Campos por salto

| Campo | Notas |
|---|---|
| Host o alias | Se puede elegir de `~/.ssh/config` (Windows o WSL) |
| Usuario | Cada salto el suyo (`diego` en el bastion, `deploy` en el destino) |
| Puerto | |
| Autenticación | Agente, llave, contraseña (bóveda) o preguntar |
| Huella | Confirmada y guardada por salto |
| Tipo de salto | **Túnel** · **Entrar desde aquí** · **Comando** (ver abajo) |
| 2FA | Marca informativa: avisa de que cada reconexión pedirá código |
| Timeout y keepalive | Por defecto 10 s / 15 s × 3; ajustables |
| Compresión | `-C` opcional, útil en enlaces lentos |

### Tipos de salto
1. **Túnel** (`ProxyJump`, por defecto): el salto solo reenvía tráfico; te autenticas en el
   siguiente con **tus** credenciales, que no salen de tu equipo.
2. **Entrar desde aquí** (`ssh salto ssh siguiente`): usa las llaves y config **del salto**.
   Necesario cuando las llaves para la red interna viven en el bastion o cuando el bastion
   prohíbe túneles (`AllowTcpForwarding no` → "administratively prohibited": se detecta y se
   propone este tipo).
3. **Comando** (`ProxyCommand`): para bastiones que no son SSH: AWS SSM
   (`aws ssm start-session`), Google IAP (`gcloud compute start-iap-tunnel`), Cloudflare Access
   (`cloudflared access ssh`), Teleport (`tsh proxy ssh`).

Nunca **reenviar el agente** (`ForwardAgent`) como atajo: root en el bastion podría usar tus llaves.

### Reglas entre saltos
- Los nombres del siguiente salto **los resuelve el anterior** (`db-interno`, `10.0.3.12`):
  PulpLog no los valida ni los resuelve localmente.
- Cada salto recibe sus propias opciones (**fase 0**: `ssh_config` temporal con un bloque `Host`
  por salto + `Include` de la config del usuario; OpenSSH propaga `-F` a los saltos).
- Windows no admite `ControlMaster`: no se reutilizan conexiones. Con 2FA, la reconexión debe ser
  prudente (espera creciente, y pedir confirmación tras varios fallos).
- `sudo`, Docker y `journalctl` se ejecutan **en el último servidor**; la interfaz lo indica.

### Prueba de conexión
Recorre la cadena en orden y se detiene en el primer fallo:

```
✓ bastion.empresa.com  120 ms  (agente, huella conocida)
✓ prod-api             45 ms   (contraseña de la bóveda)
✓ /var/log/app.log     legible · 2,3 MB · último cambio hace 4 s
```

## 6. Qué leer

| Fuente | Detalle |
|---|---|
| Archivo | Ruta o patrón; explorador con tamaño, fecha, favoritos y rutas recientes por servidor |
| Contenedor Docker remoto | Por nombre (sobrevive a recreaciones) |
| `journalctl` | Por unidad (`-u nginx`), con `--since` para el historial inicial |
| Comando personalizado | Con advertencia explícita; solo lectura recomendada |

- **Leer como root**: `sudo -S` con la contraseña por la entrada estándar (por defecto la de SSH
  del último servidor, o una propia). Error claro si el usuario no tiene sudo.
- **Zona horaria del log**: afecta a la línea de tiempo, a las búsquedas por hora del chat y a
  combinar bitácoras.
- **Codificación**: UTF-8, Latin-1, Windows-1252.

## 7. WSL

- **WSL local deja de ser un modo**: los archivos de WSL se abren como archivos locales por
  `\\wsl.localhost\<distro>\…` (acceso directo en "Abrir archivo" y en la bienvenida). Ganan
  combinar sin temporales, patrones de workspace, recientes y sesión.
- **Logs de root en WSL local**: "Abrir como root" usa `wsl -d <distro> -u root` internamente,
  sin contraseña. **Pendiente de verificar** si `\\wsl.localhost` ya permite leerlos.
- **"SSH desde WSL" deja de ser un modo**: pasa a "Configuración SSH de: Windows ▾ / WSL <distro>".
  - Solo se listan distros con cliente `ssh`; se indica si su agente tiene llaves.
  - Aviso si la distro está apagada (el primer arranque tarda unos segundos).
  - La passphrase del agente de WSL: botón "Abrir terminal de <distro>" o `SSH_ASKPASS`.

## 8. Interfaz

- Botón de la barra: **"SSH"** (o "Remoto"), abre la lista de servidores.
- **Lista de servidores**: estado (última conexión ✓/✗), búsqueda, agrupado por entorno.
- **Asistente en 3 pasos** al crear: Servidor → Qué leer → Opciones.
- **Entornos con color**: la pestaña lleva la franja del entorno (prod en rojo).
- **Estado en la pestaña**: conexión, "reconectando en 8 s", tooltip con la cadena de saltos.
- **Ayuda en contexto** junto al campo que falla; los comandos copiables del agente solo
  aparecen cuando el agente no tiene llaves.
- **Conexión rápida**: `Ctrl+K` → "prod-api / app.log" → Enter.

## 9. Configurable

**Por servidor**: zona horaria, codificación, historial inicial, timeout, reconexión, sudo,
compresión, entorno y color.

**Global**:
- Importar servidores desde `~/.ssh/config` (Windows o WSL).
- Exportar e importar servidores en JSON **sin secretos**.
- Bloqueo automático de la bóveda tras X minutos.
- Consulta del agente solo con el diálogo abierto.

## 10. Seguridad

- Secretos: bóveda cifrada o memoria de sesión; nunca en argumentos, entorno visible, archivos
  ni registros. El auxiliar de `SSH_ASKPASS` usa un canal de un solo uso.
- Los archivos de configuración temporales de saltos no contienen secretos y se borran al arrancar.
- Validación estricta de hosts, usuarios, puertos y saltos (sin `-` inicial, espacios, comodines
  ni metacaracteres).
- Sin `ForwardAgent`. Huellas confirmadas por servidor.
- Exportaciones sin secretos.

## 11. Migración

| Perfil actual | Pasa a |
|---|---|
| SSH del sistema | Servidor con config de Windows + bitácora |
| SSH directo | Servidor (contraseña de la bóveda conservada) + bitácora |
| SSH desde WSL | Servidor con config de `WSL <distro>` + bitácora |
| WSL local | Archivo `\\wsl.localhost\<distro>\…` (o "como root") |

Perfiles que comparten host, usuario y saltos se agrupan en un mismo servidor.

## 12. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Argumentos de `ssh` unificados (`sshInvocation.cjs`); opciones por salto con `ssh_config` temporal | **Hecho** |
| 1 | Contraseña en el SSH del sistema con `SSH_ASKPASS` (Windows y WSL); diálogo para peticiones 2FA; contraseña interactiva en el motor directo | **Hecho** (`askpass.cjs`) |
| 2 | Cadena de saltos visual con campos por salto, tipos de salto y prueba salto a salto | |
| 3 | Modelo servidor/bitácoras, lista de servidores, entornos con color, migración de perfiles | |
| 4 | WSL local como archivos `\\wsl.localhost`; "SSH desde WSL" como opción | **Hecho** (`src/wslPaths.mjs`) |
| 5 | `sudo`, `journalctl`, zona horaria y codificación | |
| 6 | Importar `~/.ssh/config`, exportar sin secretos, `Ctrl+K`, bloqueo de la bóveda | |

## 13. Pendiente de verificar

- ~~`SSH_ASKPASS_REQUIRE=force` con OpenSSH para Windows 9.5~~: verificado (Windows 9.5 y Ubuntu 9.6, con interop desde WSL).
- ~~Lectura de logs de root por `\\wsl.localhost`~~: verificado. Se leen con los permisos del usuario
  predeterminado (grupo `adm` incluido); los exclusivos de root dan `EPERM` y se abren con `wsl -u root`.
- Comportamiento de `ProxyJump` en el motor directo con 2FA en el salto.
