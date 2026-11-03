---
description: Instala y configura AI Voice-InterConnector (binario + modelos + daemon) y activa la narración por voz y las notificaciones de escritorio de este plugin. Procedimiento guiado, multiplataforma e idempotente.
argument-hint: "(sin argumentos)"
---

# Instalación guiada de EvolutiveX Agents (narración por voz y notificaciones de escritorio)

Eres el asistente que guía al usuario para dejar operativo el plugin **EvolutiveX Agents** (`evolutivex-agents`): instalar el motor **AI Voice-InterConnector**, descargar sus modelos, dejar el daemon listo y activar tanto la narración por voz como las notificaciones de escritorio (incluido el registro del AUMID en Windows). Ejecuta este procedimiento paso a paso con la herramienta de shell, **informando antes de cada acción** y pidiendo confirmación antes de descargar o instalar algo.

## Reglas de conducta (obligatorias)

- **Detecta el sistema operativo primero** y usa los comandos correctos (bash en
  Linux/macOS, PowerShell en Windows). No asumas el SO.
- **Idempotente**: cada paso debe comprobar si ya está satisfecho y saltarlo si es
  así. Es seguro re-ejecutar el comando completo.
- **Nunca** ejecutes acciones destructivas ni uses `sudo`. AI Voice-InterConnector se instala
  a nivel de usuario.
- **No manejes claves de API en el chat** (quedarían en el transcript). Para la
  clave, guía al usuario a definir la variable de entorno `GEMINI_API_KEY`.
- Si un paso requiere una acción manual del usuario (instalador gráfico,
  reiniciar la terminal para el PATH),
  **detente y explica** con claridad qué debe hacer antes de continuar.
- Al final, **verifica** que todo funciona con una narración de prueba real.

---

## Paso 0 — Diagnóstico del estado actual

1. Comprueba si el CLI ya está en el PATH:
   - Linux/macOS: `command -v ai-voice-interconnector`
   - Windows: `where ai-voice-interconnector` (o `Get-Command ai-voice-interconnector`)
2. Si **está presente**, corre `ai-voice-interconnector doctor --json` y analiza el JSON:
   emite un solo objeto con `checks: {name, ok, detail}[]` y `failed: string[]` (los
   names de los checks fallidos; vacío = sano). Con esto sabes qué falta realmente:
   - **Exit `0`** con `failed` vacío → todos los checks pasan: el motor ya está listo;
     salta al **Paso 3** (daemon) y luego al **Paso 4** (pre-síntesis) y al
     **Paso 6** (verificación).
   - **Exit `1`** con `failed` no vacío → revisa qué checks fallan (el reporte es
     el MISMO, sin objeto de error detrás):
     - **Recursos**: `models_provisioned` → salta al **Paso 2** (`setup`);
       `onnx_runtime` → reinstala con el **Paso 1**. Sin ellos la narración no
       funciona y el hook `SessionStart` no levanta el daemon.
     - **Instalación o ciclo de vida**: `install_receipt`, `path_resolves`,
       `path_duplicates`, `pending_artifacts` o un check desconocido → el motor
       puede narrar; informa al usuario los nombres y el `detail`, remite a
       `ai-voice-interconnector doctor --json` y continúa con el **Paso 3**.
       Nunca ejecutes `doctor --repair` por tu cuenta. Mientras sigan fallando,
       `SessionStart` mostrará un aviso en cada sesión, sin bloquearla y
       levantando igual el daemon.
   - **Exit `1`** con un objeto `reason: "doctor_failed"` → falló el comando doctor
     (no el veredicto): re-ejecútalo antes de continuar.
3. Si **no está presente**, continúa al **Paso 1**.

Resume al usuario en una frase qué encontraste y qué vas a hacer.

## Paso 1 — Instalar el binario AI Voice-InterConnector (instalador nativo por SO)

Usa el instalador nativo que corresponde al SO. La release actual publica los instaladores `install.sh` (Linux y macOS) e `install.ps1` (Windows), además de los binarios por plataforma y `SHA256SUMS.txt`. Cada uno descarga
el binario, lo agrega al PATH del usuario (sin `sudo`) y encadena `setup`
automáticamente:

- **Linux** y **macOS**:

  ```bash
  curl -fsSL https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/releases/latest/download/install.sh | sh
  ```

- **Windows** (PowerShell):

  ```powershell
  irm https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/releases/latest/download/install.ps1 | iex
  ```

Tras instalar por cualquier vía, **verifica**: `ai-voice-interconnector version`. Si el comando no se encuentra, probablemente el PATH aún no se recargó: indica al usuario abrir una terminal nueva (o reiniciar Claude Code) y reanuda.

## Paso 2 — Descargar los modelos

```bash
ai-voice-interconnector setup
```

`setup` provisiona la selección de **seis modelos** (idempotente; el instalador del
Paso 1 ya lo encadena, así que normalmente esto solo confirma el estado):

- `qwen3-tts-0.6b` (CustomVoice) y `qwen3-tts-0.6b-base` (Base): el modelo **Base es
  requerido por las voces clonadas**, incluida la voz de fábrica `default`.
- `opus-mt-es-en` y `opus-mt-en-es` (traducción) y `parakeet-tdt-v3` (STT).
- `dpdfnet8` (limpieza de ruido): opcional para arrancar el daemon y necesario para las operaciones que solicitan `--denoise`.

Advertencias a comunicar:

- La selección completa requiere aproximadamente **5,9 GB** de descarga y puede tardar.
- La descarga es **anónima**: los modelos son repositorios públicos de Hugging
  Face, no hace falta cuenta y `setup` ignora `HF_TOKEN` y el token de
  `huggingface-cli login`. Respeta `HF_ENDPOINT`, `HF_HUB_CACHE` y `HF_HOME`.
- Si `setup` falla, distingue la causa por el código o por el `reason` de
  `ai-voice-interconnector setup --json`: `network_error` (exit `20`, red o
  servidor) se resuelve reintentando `setup`; `model_unavailable` (exit `1`,
  Hugging Face rechazó un modelo fijado) **no** se resuelve reintentando: hace
  falta una versión del motor que vuelva a fijar el modelo (actualiza el motor
  con el **Paso 1**).

## Paso 3 — Dejar el daemon en marcha

El plugin narra con `speech say --daemon`, que **usa el daemon y falla si no está levantado** (no lo arranca solo). El daemon mantiene el modelo en memoria, así cada narración tarda segundos en vez de decenas.

```bash
ai-voice-interconnector daemon start
ai-voice-interconnector daemon status
```

Explica que el daemon queda vivo en segundo plano y sobrevive al cierre de Claude Code (no a un reinicio del equipo). Tras un reinicio no hace falta acción manual: el hook `SessionStart` del plugin lo vuelve a levantar solo en la primera sesión nueva (siempre que la narración esté activada y el modelo en caché). Este arranque durante la instalación es solo para dejarlo caliente ya mismo.

## Paso 4 — Pre-sintetizar los anuncios

Con el daemon recién levantado (precondición exacta de este paso), pre-sintetiza los anuncios estáticos del plugin — el acuse de `UserPromptSubmit` («Procesando con Claude») y los fallbacks por evento — para que en cada turno se reproduzcan al instante con `speech play`, sin modelo ni daemon:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" presynth
```

Interpreta el resultado:

- **Exit `0`** → todos los anuncios quedaron pre-sintetizados. El exit `6`
  (`label_exists`) de `speech synthesize` por una etiqueta ya existente cuenta como
  **éxito** (idempotencia) y se reporta como «ya pre-sintetizado»: es seguro repetir
  el comando.
- **Exit final ≠ `0`** → algún anuncio falló. La salida imprime el código interno del
  motor (`5`, `4`, …) como referencia del motor, **no como diagnóstico del plugin**:
  un código de fallo por sí solo no demuestra que el sidecar esté corrupto.
  - `5` (daemon caído) → vuelve al **Paso 3** y reintenta.
  - `4` (modelo ausente) → vuelve al **Paso 2** (`ai-voice-interconnector setup`) y
    reintenta.
  - Si una locución concreta quedó dañada o desactualizada, elimina **solo esa**
    etiqueta con `ai-voice-interconnector speech remove --label <etiqueta> [--voice <voz>]`
    y re-ejecuta `presynth`. No uses `cleanup --all` ni `cleanup --synthetic-speech`
    como primer remedio.

## Paso 4b — Clonar tu voz (opcional)

Con `default` ya pre-sintetizada, pregunta al usuario si quiere que la narración use **su propia voz**. Si no, sigue al **Paso 5**: `default` queda lista y funcional.

Si acepta, sigue el flujo `clone` del comando `/evolutivex-agents:voice` (explicación de la referencia y de la privacidad, confirmación, timeout de la herramienta de shell en 600000 ms y `--duration 10` para el micrófono):

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" voice clone --display-name "<nombre>" "<ruta.wav>"
node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" voice clone --display-name "<nombre>" --mic --duration 10
```

La voz se guarda como `custom`, la única voz propia; `--display-name` (opcional) le da un nombre de presentación, por ejemplo el del usuario. Con exit `0`, la voz queda clonada y con sus anuncios pre-sintetizados: indica al usuario que elija `custom` en el selector de `/config` → `evolutivex-agents.voice`. Desde el siguiente evento, la narración usa esa voz.

## Paso 5 — Activar la narración, las notificaciones de escritorio y, opcionalmente, el modo LLM

1. Asegura que tanto la narración por voz como las notificaciones de escritorio están activas y revisa el estado:
   - En `/config`, fija `evolutivex-agents.voiceEnabled` y `evolutivex-agents.notificationsEnabled` a `true`.

   Verifica con:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" status
   ```

2. **En Windows**, registra de forma idempotente el AUMID `EvolutiveX.Agents` y el acceso directo en el Menú Inicio para que los toasts muestren el nombre `EvolutiveX Agents` y su icono en la cabecera (a nivel de usuario en `HKCU` y `%APPDATA%`, sin `sudo` ni privilegios de administrador):

   ```powershell
   node "${CLAUDE_PLUGIN_ROOT}/dist/notification-register.js" --install
   node "${CLAUDE_PLUGIN_ROOT}/dist/notification-register.js" --status
   ```

   En Linux y macOS este paso no es necesario (el notificador nativo aplica el icono directamente).

3. **Modo de mensajes de voz** (pregunta al usuario su preferencia):
   - `local` (por defecto, 100 % offline, mensajes simples): en `/config`, fija `evolutivex-agents.messageMode` a `local`.
   - `llm` (mensajes más elaborados vía Gemini free tier): en `/config`, fija `evolutivex-agents.messageMode` a `llm`.
4. Si elige `llm`, **advierte sobre privacidad**: contenido de la sesión sale
   hacia Google (Gemini). La clave es del usuario; guíalo a definirla por
   variable de entorno, sin escribirla en el chat:
   - `GEMINI_API_KEY` (Gemini free tier). Se lee solo del entorno; el plugin no
     la guarda en disco.
   - Windows (PowerShell, sesión actual): `$env:GEMINI_API_KEY = "..."`.
     Persistente: `setx GEMINI_API_KEY "..."` o Propiedades del sistema →
     Variables de entorno.
   - Linux/macOS (sesión actual): `export GEMINI_API_KEY=...`. Persistente:
     añadir el `export` a `~/.bashrc` o `~/.zshrc`.
   - Si la variable se define de forma persistente, hay que abrir una terminal
     nueva o reiniciar Claude Code para que la sesión la herede. Sin clave,
     `llm` degrada a `local` de facto.

## Paso 6 — Verificación de extremo a extremo

1. Diagnóstico final: `ai-voice-interconnector doctor --json`. Confirma exit `0` con
   `failed: []` (todos los entries de `checks` con `ok: true`). Si solo fallan
   checks de instalación (`install_receipt`, `path_*`, `pending_artifacts`), la
   narración funciona igual: aplica la distinción del **Paso 0**.
2. Narración de prueba real (debe sonar audio):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" say "La narración por voz quedó lista"
   ```

3. Reproducción de un anuncio pre-sintetizado (verifica la ruta `speech play` que usará
   `UserPromptSubmit`): toma un label de la salida del Paso 4 (por ejemplo el de
   `UserPromptSubmit`, con forma de slug fijo como `voice-user-prompt-submit`) y
   reprodúcelo con la voz activa (`default`, o la clonada en el **Paso 4b** si
   el usuario ya la fijó en `/config`):

   ```bash
   ai-voice-interconnector speech play --label <label-del-anuncio> --voice <voz> --json
   ```

   Debe sonar el anuncio con exit `0`. Un exit `3` tiene cuatro causas, que el
   campo `reason` del JSON distingue: `speech_not_found` (anuncio no
   pre-sintetizado para esa voz → `narrate-ctl.js presynth --voice <voz>`);
   `voice_not_found` (la voz no existe → consulta `narrate-ctl.js voice list` y
   elige otra en `/config` → `evolutivex-agents.voice`); `no_output_device` (el sistema no
   tiene salida de audio predeterminada → configúrala;
   `ai-voice-interconnector devices` la muestra); `audio_backend_unavailable`
   (falta el backend de audio del sistema, en Linux ALSA/`libasound.so.2`). Un
   exit `1` con `playback_failed` es un fallo de reproducción.

4. Notificación de escritorio de prueba (verifica el canal visual nativo):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/notification-cli.js" --event-type SessionStart --message "Notificaciones de escritorio listas" --silent
   ```

   Pregunta al usuario si escuchó las locuciones y vio la notificación de escritorio. Si el audio no sonó:
   - Reconfirma que el daemon está `running` (Paso 3).
   - Revisa `worker.log` en el state dir (`narrate-ctl.js status` da la ruta):
     cada fallo de `speech play` o `speech say` queda registrado con su código y,
     si el motor informó un `reason` conocido, con su causa y su remedio.

## Cierre

Confirma al usuario, en pocas frases, que a partir de ahora **cada sesión de Claude Code narrará por voz y emitirá notificaciones de escritorio automáticamente**: el hook `SessionStart` verifica el entorno y levanta el daemon si hace falta; el canal de voz narra `UserPromptSubmit`, `Stop`, `SubagentStop`, `StopFailure` y `Notification`, mientras el canal de notificaciones muestra toasts silenciosos con icono propio en los 12 eventos del ciclo de vida de forma independiente del motor de voz. El daemon se relevanta solo en la primera sesión tras un reinicio (hook `SessionStart`), así que no hay mantenimiento manual. Recuérdale los controles a demanda de la skill `/evolutivex-agents:narrate` (`status`, `say` y `presynth`); las preferencias se cambian en `/config` → `evolutivex-agents.*`. Explícale que puede narrar con **su propia voz**: la clona con `/evolutivex-agents:voice clone` (o la clonó en el **Paso 4b**) y la activa en `/config` → `evolutivex-agents.voice`; para volver a la predeterminada, fija `default`. Cuéntale también que existe el **transcript enriquecido** (hora de inicio, duración y contadores en vivo en cada bloque del transcript), desactivado por defecto, que se activa en `/config` → `evolutivex-agents.enhancedTranscript`.

Menciona también el mantenimiento de los anuncios pre-sintetizados: si se borran las locuciones del almacén del motor (`<data_dir>/speech/<voz>/<etiqueta>.wav`), basta re-ejecutar `node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" presynth` con el daemon caliente (es idempotente; los anuncios vigentes no se re-sintetizan). Ten en cuenta que `--synthetic-speech` es una categoría de `cleanup`, no una carpeta. Como los labels son slugs fijos, si en una actualización del plugin **cambia la frase** de un anuncio, `presynth` a secas no lo detecta (el label no cambió): hay que forzar la sobreescritura con `node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" presynth --force`.
