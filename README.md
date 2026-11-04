# EvolutiveX Agents

Plugin de [Claude Code](https://code.claude.com) que **narra por voz** la actividad de la sesión usando [AI Voice-InterConnector](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector) y emite **notificaciones de escritorio nativas** (toasts silenciosos con icono por evento). Al final de cada turno (y en anuncios relevantes) escuchas un mensaje conversacional corto y recibes un aviso visual independiente del motor de voz. Opcionalmente, el **transcript enriquecido** muestra en cada bloque del transcript su hora de inicio, su duración y contadores en vivo.

> **Beta 0.1.0, solo en español.** Verificado en Windows 11; Linux y macOS son experimentales. Si algo falla, repórtalo con la [plantilla de issue](https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/issues/new?template=bug_report.md).

- **Automático**: disparado por hooks; sin intervención del modelo ni tuya.
- **No intrusivo**: nunca bloquea ni retrasa el turno; los canales de voz y
  escritorio son independientes y fallan en silencio.
- **Multiplataforma**: Windows / Linux / macOS (registro AUMID e icono de cabecera en Windows; en macOS y Linux usa el notificador nativo del SO).
- **Sin prerequisitos de runtime**: los scripts corren sobre el Node.js que
  Claude Code ya trae; no exige Python.
- **Costo cero**: los mensajes se generan con el nivel gratuito de Gemini
  (opt-in) y degradan a un modo local determinista.
- **Controlable**: activa/desactiva la narración y las notificaciones de escritorio por separado sin desinstalar.
- **Opt-in donde importa**: lo que envía datos fuera o altera la UI de Claude Code (modo `llm`, transcript enriquecido) está desactivado por defecto.

---

## Inicio rápido

```bash
# 1. Instalar el plugin (persiste entre sesiones)
/plugin marketplace add CristianRojas-SoftwareEngineer/EvolutiveX-Agents
/plugin install evolutivex-agents@EvolutiveX-Agents

# 2. Instalar y configurar el motor (guiado, detecta SO, descarga modelo, pre-sintetiza)
/evolutivex-agents:install
```

El comando de instalación guía todo el proceso: detecta tu SO, instala el binario nativo, descarga los 6 modelos, levanta el daemon, pre-sintetiza los 6 anuncios estáticos y activa la narración.

---

## Cómo funciona

El plugin se integra via **hooks de Claude Code** y consume la **CLI pública** de AI Voice-InterConnector (`ai-voice-interconnector` en el `PATH`). No hay código compartido ni dependencias de build.

| Hook                                            | Acción                             | Superficie CLI                                                                            |
| ----------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `UserPromptSubmit`                              | Acuse fijo «Procesando con Claude» | `speech play --label --voice`                                                             |
| `Stop`                                          | Resumen del turno (local o LLM)    | `speech say --voice --daemon`                                                             |
| `SubagentStop` / `StopFailure` / `Notification` | Avisos pre-sintetizados            | `speech play --label --voice`                                                             |
| `SessionStart`                                  | Health-check + daemon autostart    | `doctor --json`, `daemon status --json`, `voice list --json`, `daemon start --warm-voice` |

Todas las rutas narran con la **voz activa** de `/config` (`default` si no está fijada), pasada siempre de forma explícita.

El modo `local` (por defecto) es 100 % offline y determinista. El modo `llm` (opt-in con `GEMINI_API_KEY`) parafrasea el último mensaje del asistente vía Gemini.

El **transcript enriquecido** es la tercera funcionalidad y no usa el motor de voz: es un módulo de _function hooks_ (`dist/transcript.js`, declarado en `modules` de `hooks/hooks.json`) que Claude Code ejecuta en su propio sandbox, sin Node ni sistema de archivos. Envuelve cada bloque del transcript (`UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput` y `AskUserQuestion`) en un recuadro con su hora de inicio y, al pie, la duración del trabajo y quién lo hizo (🧠 modelo, 🔧 herramienta o comando, 👤 usuario, 🔌 hooks); añade la hora al Spinner y a TurnDuration y mantiene contadores en vivo mientras corre una herramienta. Está **desactivado por defecto**.

---

## Configuración

### Configuración (`/config`)

Todas las preferencias se configuran en `/config` → `evolutivex-agents.*`. El cambio se aplica al momento, sin `/reload-plugins` ni reiniciar.

| Clave                  | Tipo    | Valor por defecto | Efecto                                                                                                                                                                                                                                                              |
| ---------------------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voiceEnabled`         | boolean | `true`            | Activa/desactiva la narración por voz. Al desactivarla se descarta lo pendiente de narrar.                                                                                                                                                                          |
| `notificationsEnabled` | boolean | `true`            | Activa/desactiva las notificaciones de escritorio nativas, incluidas las de problemas de voz.                                                                                                                                                                       |
| `messageMode`          | string  | `local`           | `local`: mensajes deterministas sin red. `llm`: mensajes conversacionales con Gemini (requiere `GEMINI_API_KEY` en el entorno; si falla, degrada a `local`).                                                                                                        |
| `voice`                | string  | `default`         | Selector de la voz con la que se narra: `default`, `ryan` o `vivian` (de fábrica) o `custom` (tu voz clonada). `ryan` y `vivian` necesitan antes sus anuncios pre-sintetizados: la instalación guiada lo ofrece, o ejecuta `narrate-ctl.js presynth --voice <voz>`. |
| `enhancedTranscript`   | boolean | `false`           | Transcript enriquecido: recuadros con hora, duración y contadores en vivo. Opt-in.                                                                                                                                                                                  |

La API key (`GEMINI_API_KEY`) se lee **solo del entorno** y nunca se persiste en disco.

### Voz de la narración y clonado

El plugin puede narrar con **tu propia voz**, clonada con el motor (requiere AI Voice-InterConnector 0.42.0 o posterior). El comando `/evolutivex-agents:voice` guía el proceso, y la instalación guiada lo ofrece de forma opcional:

```text
/evolutivex-agents:voice clone [<nombre de presentación>] [<ruta.wav> | --mic [--duration <segs>]]
/evolutivex-agents:voice list
/evolutivex-agents:voice remove <voz>
```

- **Una sola voz propia, `custom`:** `/config` solo ofrece un selector con opciones fijas, así que tu voz se guarda siempre como `custom`. Clonar de nuevo la reemplaza (con `--force`). Puedes darle un **nombre de presentación** (por ejemplo, el tuyo), que se muestra en `status` y `voice list` como `custom «Cristián»`.

- **Referencia:** unos 10 s de habla clara (máximo 30 s), desde un archivo WAV o el micrófono. `--denoise` limpia el ruido de fondo de forma opcional.
- **Activación:** el clonado pre-sintetiza los seis anuncios con la voz nueva y luego indica elegir `custom` en `/config` → `evolutivex-agents.voice`. El plugin nunca activa una voz por su cuenta; el cambio se oye desde el siguiente evento.
- **Costo de cambiar de voz:** cada voz tiene sus propios anuncios (seis síntesis, una sola vez) y la primera síntesis con otra voz tarda algo más mientras el daemon la carga.
- **Sin fallback:** si la voz activa no existe (por ejemplo, `custom` sin clonar) o su valor no es una de las opciones, `SessionStart` lo avisa y la narración falla con el remedio en `worker.log`, en lugar de sonar otra voz. Si la voz no existe, no tiene sus anuncios o su nombre no es válido, el worker te lo notifica además en el escritorio, una vez por problema. Con la voz ausente y el daemon parado, `SessionStart` arranca el daemon precalentando `default` para que puedas clonar o pre-sintetizar; la narración sigue pidiendo la voz elegida.
- **A demanda:** `narrate-ctl say` y `presynth` aceptan `--voice <voz>`; sin él usan la voz activa del último evento narrado, que `status` muestra.

### Transcript enriquecido (`/config`)

Se activa con `evolutivex-agents.enhancedTranscript` (boolean, `false` por defecto). El cambio se aplica al momento, sin `/reload-plugins` ni reiniciar. Requiere Claude Code v2.1.287 o posterior. No se controla con `narrate-ctl`: el sandbox de _function hooks_ no puede leer archivos locales, así que la opción vive en el `userConfig` del plugin.

**Protección:** si un handler del transcript, su reloj o su volcado al almacenamiento fallan por su propio código 3 veces seguidas, el transcript enriquecido se apaga hasta el final de la sesión y Claude Code sigue con su transcript nativo. Un único toast indica la causa y la versión de Claude Code: cópialo en el reporte. Los errores que no son del plugin (por ejemplo, una herramienta interrumpida) no cuentan.

### Qué está activo por defecto

Una funcionalidad es **opt-out** (activa por defecto) solo si no altera ni intercepta Claude Code y además no saca datos ni tiene costo; todo lo demás es **opt-in**:

| Funcionalidad             | Altera o intercepta Claude Code | Saca datos o tiene costo     | Por defecto |
| ------------------------- | ------------------------------- | ---------------------------- | ----------- |
| Narración por voz local   | No                              | No                           | Activa      |
| Notificaciones escritorio | No                              | No                           | Activa      |
| Modo `llm`                | No                              | Sí (último mensaje a Gemini) | Opt-in      |
| Transcript enriquecido    | Sí (UI del transcript)          | No                           | Opt-in      |

### Notificaciones de escritorio (CLI y branding Windows)

El canal visual se ejecuta desde `dist/notification-hook.js` para los eventos `UserPromptSubmit`, `PreToolUse` (`AskUserQuestion`), `PostToolUse` (`TaskUpdate` con `status: "in_progress"` → `TaskInProgress`), `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `SessionStart`, `SessionEnd`, `PermissionRequest`, `TaskCreated` y `TaskCompleted`. Por defecto los hooks emiten toasts **silenciosos** con el icono específico del evento bajo `assets/notifications/events/` y el AUMID `EvolutiveX.Agents`.

- **Avisos de problemas de voz:** el worker de narración emite además, con `dist/notification-cli.js`, una notificación con el remedio cuando la voz activa no existe, no tiene sus anuncios o su nombre no es válido, una sola vez por problema.
- **Control del canal:** `/config` → `evolutivex-agents.notificationsEnabled`.
- **CLI manual (`dist/notification-cli.js`):** conserva todas las opciones (`--event-type`, `--message`, `--title`, `--sound`, `--silent`, `--stdin-json`, `--app-id`, `--icon`):
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/dist/notification-cli.js" --event-type Stop --message "Listo"
  ```
- **Branding en Windows (`dist/notification-register.js`):** registra el AUMID `EvolutiveX.Agents` y el acceso directo `EvolutiveX-Agents.lnk` en el Menú Inicio:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/dist/notification-register.js" --install
  node "${CLAUDE_PLUGIN_ROOT}/dist/notification-register.js" --status
  node "${CLAUDE_PLUGIN_ROOT}/dist/notification-register.js" --uninstall
  ```

### Clave API (solo modo `llm`)

La clave se lee **exclusivamente** de la variable de entorno `GEMINI_API_KEY`; el plugin no la guarda en disco.

**Windows (PowerShell, sesión actual):**

```powershell
$env:GEMINI_API_KEY = "..."
```

**Windows (persistente para el usuario):**

```powershell
setx GEMINI_API_KEY "..."
```

`setx` no afecta a la sesión actual: abre una terminal nueva o reinicia Claude Code. También puedes definirla en **Propiedades del sistema → Variables de entorno**.

**Linux/macOS (sesión actual):**

```bash
export GEMINI_API_KEY=...
```

**Linux/macOS (persistente):** añade el `export` a `~/.bashrc` o `~/.zshrc` y abre una terminal nueva.

Notas:

- Claude Code lanzado desde una GUI puede no heredar el entorno de la shell. Si `status` reporta la clave ausente, define la variable de forma persistente (o lanza Claude Code desde una terminal donde esté definida) y reinicia Claude Code.
- No uses `.env`: el plugin no lo lee.
- Para activar el parafraseo: define `GEMINI_API_KEY` y fija `/config` → `evolutivex-agents.messageMode` en `llm`. `status` confirma `gemini key: configurada` sin mostrar el valor.

Ver modelo de amenazas completo en [SECURITY.md](SECURITY.md). La skill `/evolutivex-agents:narrate` muestra el estado y narra a demanda; las preferencias se cambian en `/config`.

---

## Privacidad

- **Modo `local`**: cero red, 100 % offline, mensajes simples.
- **Clonado de voz**: es local. El motor guarda solo la huella del timbre de la referencia; el audio no sale de la máquina y el plugin no lo copia, mueve ni conserva. `userConfig` solo guarda el nombre de la voz.
- **Modo `llm`**: solo en evento `Stop` envía `last_assistant_message` (sin transcript ni historial) a Google (Gemini). Opt-in explícito: requiere `GEMINI_API_KEY` y `messageMode` en `llm`.
- El resto de hooks (`UserPromptSubmit`, `SubagentStop`, `StopFailure`, `Notification`) **nunca** usan red: reproducen avisos pre-sintetizados locales.
- **Transcript enriquecido**: solo guarda horas y duraciones de los bloques en el almacenamiento local que Claude Code da al plugin (un bucket por día, 30 días de retención y como máximo 3,5 MiB) para que una sesión reanudada muestre las mismas cifras. No envía nada fuera.

---

## Solución de problemas

- **No se oye nada:** `ai-voice-interconnector doctor --json` diagnostica la instalación del motor (binario en el PATH, modelos y runtime ONNX); `ai-voice-interconnector daemon status --json` indica si el daemon corre; la skill `/evolutivex-agents:narrate` con `status` muestra la voz activa, si la clave de Gemini está configurada y la ruta del _state dir_.
- **Errores de la narración:** el worker los escribe en `worker.log`, en el _state dir_:

  | SO      | Ruta                                                             |
  | ------- | ---------------------------------------------------------------- |
  | Windows | `%LOCALAPPDATA%\evolutivex-agents\worker.log`                    |
  | Linux   | `${XDG_STATE_HOME:-~/.local/state}/evolutivex-agents/worker.log` |
  | macOS   | `~/Library/Application Support/evolutivex-agents/worker.log`     |

  Al superar 512 KiB se renombra a `worker.log.1` (que reemplaza al anterior), y `worker.log.1` se borra tras 14 días sin cambios: como máximo, 2 archivos y 1 MiB.

  El mismo directorio guarda `active-voice` (la voz activa del último evento, que leen `say` y `presynth`), `custom-display-name` (el nombre de presentación de tu voz `custom`), `voice-problem.json` (el último problema de voz notificado, para no repetir el aviso) y, mientras dura una operación manual de voz, el bloqueo `voice-operation.lock`.

- **`speech_not_found` en `worker.log` o en una notificación:** la voz activa no tiene sus anuncios pre-sintetizados. Ejecuta `node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" presynth --voice <voz>` con el daemon caliente.
- **`voice_not_found`, notificación o aviso de voz inexistente al iniciar sesión:** la voz de `/config` → `evolutivex-agents.voice` no existe en el motor; con `custom`, todavía no clonaste tu voz. Clónala con `/evolutivex-agents:voice clone` o elige otra (por ejemplo, `default`).
- **«Hay otra operación de voz en curso»:** otra operación de `clone`, `remove` o `presynth` tiene el bloqueo. Si no hay ninguna en marcha, borra `voice-operation.lock` del _state dir_.

- **El transcript enriquecido desapareció a mitad de sesión:** se apagó por fallos repetidos (ver la protección en [Transcript enriquecido](#transcript-enriquecido-config)); el toast indica la causa. Vuelve al reiniciar Claude Code o con `/reload-plugins`.
- **Reportar un error:** usa la [plantilla de issue](https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/issues/new?template=bug_report.md), que pide las versiones, la salida de `doctor --json`, las líneas de `worker.log` y el texto del toast.

---

## Desarrollo

```bash
npm install        # dependencias de dev (typescript, esbuild)
npm run typecheck  # verificación de tipos
npm run build      # compila src/ → dist/ (commitear dist/)
npm run check-dist # verifica dist/ sincronizado con src/
npm test           # suite de Node (tests/*.spec.ts con node --test, sin framework externo)
npm run test:transcript  # tests del transcript enriquecido (src/transcript/*.test.ts, kit oficial)
npx tsc -p src/transcript  # tipos del transcript enriquecido (sandbox de function hooks)
```

`npm run test:transcript` compila `dist/` y ejecuta `claude plugin test .`, que prueba el módulo `dist/transcript.js` con el kit oficial `claude-code/testing` en un entorno como el de los hooks reales; requiere el CLI de Claude Code instalado. Recorre todos los `*.test.ts` del plugin, por eso los tests de Node usan el sufijo `.spec.ts`.

`npx tsc -p src/transcript` usa los tipos de la API de _function hooks_ que Claude Code genera en `.claude-plugin/types/` (no versionados) al cargar el plugin con `claude --plugin-dir .`; sin ellos no puede ejecutarse, por eso no forma parte de CI.

### Reglas del nombre del plugin

- Identidad pública: `evolutivex-agents@EvolutiveX-Agents`
- Namespace: `/evolutivex-agents:*`
- No puede empezar por `claude-` (reservado por Anthropic)
- Debe ser kebab-case (requisito marketplace Claude.ai)

Validación local (mismo gate que CI):

```bash
claude plugin validate --strict .
```

### Distribución

`dist/` **se commitea**: los plugins se instalan clonando el repo, así que el JS compilado debe estar en el árbol para que los hooks funcionen sin paso de build.

### CI

CircleCI (`.circleci/config.yml`): `check-dist`, `lint`, `format:check`, `typecheck` y `test` en Linux; `check-dist`, `typecheck` y `test` en Windows/macOS; `validate-manifest` (manifiestos, nombre del plugin y módulo de _function hooks_ `dist/transcript.js`, cuyos hooks y llamadas también analiza `claude plugin validate --strict`, más `npm run test:transcript` con el CLI fijado).

---

## Documentación

- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — contrato CLI, hooks, requisitos, degradación (perspectiva plugin).
- [`docs/RELEASING.md`](docs/RELEASING.md) — proceso de release y sincronización con motor.
- [`SECURITY.md`](SECURITY.md) — política de seguridad, modelo de amenazas, credenciales.
- [`CHANGELOG.md`](CHANGELOG.md) — cambios por versión.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — direcciones futuras del plugin.

Contraparte del motor: [AI-Voice-InterConnector/docs/CLI/CONTRACT.md §12](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/v0.42.0/docs/CLI/CONTRACT.md#12-contratos-externos) — verificado contra AI Voice-InterConnector v0.42.0.

---

## Licencia

MPL-2.0. Ver `LICENSE` y `NOTICE`.
