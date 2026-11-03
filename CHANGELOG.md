# Changelog

Todos los cambios notables de **EvolutiveX Agents** se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

Verificado contra **AI Voice-InterConnector v0.42.0**.

### Modificado

- Renombrado canónico a **EvolutiveX Agents** (`evolutivex-agents`).
- `src/` organizado por funcionalidad: `lib/` (compartido), `voice/`, `notifications/` y `transcript/`.

### Añadido

- Narración por hooks: `UserPromptSubmit` con acuse fijo, `Stop` con resumen `local` o `llm`, y `SubagentStop`, `StopFailure` y `Notification` con avisos pre-sintetizados.
- Cola FIFO de narración en disco, sin solapamiento ni duplicación.
- `SessionStart` con gate de recursos y arranque del daemon sin bloquear la sesión.
- Diagnóstico por `reason` del motor en `worker.log`.
- Timeouts de invocación del CLI, con continuación de la cola al excederlos; el de `speech say` crece con el texto, porque cubre síntesis y reproducción.
- Tope común de 2 oraciones y 500 caracteres para toda locución dinámica, también la del modo `llm`.
- Modos de mensaje `local` (por defecto, offline) y `llm` (Gemini, opt-in con `GEMINI_API_KEY`).
- Saneamiento del texto para voz antes de narrar o de enviarlo a un proveedor externo.
- Notificaciones de escritorio con icono por evento y registro del AUMID en Windows.
- `narrate-ctl` con `voice-on`/`voice-off`, `notifications-on`/`notifications-off`, `mode`, `status`, `say` y `presynth [--force]`.
- Instalación guiada `/evolutivex-agents:install` y skill `/evolutivex-agents:narrate`.
- Licencia MPL-2.0.
- Transcript enriquecido opt-in (`/config` → `enhancedTranscript`): recuadros con la hora de inicio y la duración de cada bloque del transcript, hora en Spinner y TurnDuration, contadores en vivo y persistencia local para sesiones reanudadas.

### Eliminado

- Lecturas del payload de hooks ajenas al contrato de Claude Code: `subject` en la raíz y `tool_input.task_subject` en los mensajes de tareas.

[No publicado]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/commits/main
