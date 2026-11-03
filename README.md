# EvolutiveX Agents

Plugin de [Claude Code](https://code.claude.com) que **narra por voz** la actividad de la sesión usando [AI Voice-InterConnector](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector) y emite **notificaciones de escritorio nativas** (toasts silenciosos con icono por evento). Al final de cada turno (y en anuncios relevantes) escuchas un mensaje conversacional corto y recibes un aviso visual independiente del motor de voz. Opcionalmente, el **transcript enriquecido** muestra en cada bloque del transcript su hora de inicio, su duración y contadores en vivo.

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

| Hook                                            | Acción                             | Superficie CLI                                          |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `UserPromptSubmit`                              | Acuse fijo «Procesando con Claude» | `speech play --label`                                   |
| `Stop`                                          | Resumen del turno (local o LLM)    | `speech say --daemon`                                   |
| `SubagentStop` / `StopFailure` / `Notification` | Avisos pre-sintetizados            | `speech play --label`                                   |
| `SessionStart`                                  | Health-check + daemon autostart    | `doctor --json`, `daemon status --json`, `daemon start` |

El modo `local` (por defecto) es 100 % offline y determinista. El modo `llm` (opt-in con `GEMINI_API_KEY`) parafrasea el último mensaje del asistente vía Gemini.

El **transcript enriquecido** es la tercera funcionalidad y no usa el motor de voz: es un módulo de _function hooks_ (`dist/transcript.js`, declarado en `modules` de `hooks/hooks.json`) que Claude Code ejecuta en su propio sandbox, sin Node ni sistema de archivos. Envuelve cada bloque del transcript (`UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput` y `AskUserQuestion`) en un recuadro con su hora de inicio y, al pie, la duración del trabajo y quién lo hizo (🧠 modelo, 🔧 herramienta o comando, 👤 usuario, 🔌 hooks); añade la hora al Spinner y a TurnDuration y mantiene contadores en vivo mientras corre una herramienta. Está **desactivado por defecto**.

---

## Configuración

### Estado (`config.json`)

`config.json` solo guarda preferencias no secretas (`voiceEnabled`, `notificationsEnabled` y `messageMode`). La API key **nunca** se escribe en este archivo.

Ubicación por SO:

| SO      | Ruta                                                              |
| ------- | ----------------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\evolutivex-agents\config.json`                    |
| Linux   | `${XDG_STATE_HOME:-~/.local/state}/evolutivex-agents/config.json` |
| macOS   | `~/Library/Application Support/evolutivex-agents/config.json`     |

Ejemplo:

```json
{
  "voiceEnabled": true,
  "notificationsEnabled": true,
  "messageMode": "local"
}
```

- `voiceEnabled`: interruptor del canal de narración por voz.
- `notificationsEnabled`: interruptor del canal de notificaciones de escritorio (independiente de `voiceEnabled`).
- `messageMode`: `"local"` (por defecto, determinista y offline) o `"llm"` (parafraseo con Gemini). Sin `GEMINI_API_KEY`, `llm` degrada a `local`.

### Transcript enriquecido (`/config`)

Se activa desde `/config` con la opción `evolutivex-agents.enhancedTranscript` (boolean, `false` por defecto). El cambio se aplica al momento, sin `/reload-plugins` ni reiniciar. Requiere Claude Code v2.1.287 o posterior. No se controla con `narrate-ctl` ni con `config.json`: el sandbox de _function hooks_ no puede leer ese archivo, así que la opción vive en el `userConfig` del plugin.

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

- **Control del canal:** `node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" notifications-on` / `notifications-off`.
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
- Para activar el parafraseo: define `GEMINI_API_KEY` y ejecuta `node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" mode llm`. `status` confirma `gemini key: configurada` sin mostrar el valor.

Ver modelo de amenazas completo en [SECURITY.md](SECURITY.md). La skill `/evolutivex-agents:narrate` expone toggles interactivos.

---

## Privacidad

- **Modo `local`**: cero red, 100 % offline, mensajes simples.
- **Modo `llm`**: solo en evento `Stop` envía `last_assistant_message` (sin transcript ni historial) a Google (Gemini). Opt-in explícito: requiere `GEMINI_API_KEY` y `mode llm`.
- El resto de hooks (`UserPromptSubmit`, `SubagentStop`, `StopFailure`, `Notification`) **nunca** usan red: reproducen avisos pre-sintetizados locales.
- **Transcript enriquecido**: solo guarda horas y duraciones de los bloques en el almacenamiento local que Claude Code da al plugin (un bucket por día, 30 días de retención y como máximo 3,5 MiB) para que una sesión reanudada muestre las mismas cifras. No envía nada fuera.

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

CircleCI (`.circleci/config.yml`): `check-dist`, `lint`, `format:check`, `typecheck` y `test` en Linux; `check-dist`, `typecheck` y `test` en Windows/macOS; `validate-manifest` (manifiestos, nombre del plugin y módulo de _function hooks_ `dist/transcript.js`, cuyos hooks y llamadas también analiza `claude plugin validate --strict`).

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
