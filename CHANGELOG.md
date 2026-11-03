# Changelog

Todos los cambios notables de **EvolutiveX Agents** se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

## [0.1.0] — 2026-11-03

Primera beta pública, solo en español. Verificado contra **AI Voice-InterConnector v0.42.0** en **Windows 11**; Linux y macOS son experimentales.

### Añadido

- Narración por hooks: `UserPromptSubmit` con acuse fijo, `Stop` con resumen `local` o `llm`, y `SubagentStop`, `StopFailure` y `Notification` con avisos pre-sintetizados.
- Cola FIFO de narración en disco, sin solapamiento ni duplicación.
- `SessionStart` con gate de recursos y arranque del daemon sin bloquear la sesión.
- Diagnóstico por `reason` del motor en `worker.log`, con rotación por tamaño (512 KiB) y antigüedad (14 días): como máximo, 2 archivos y 1 MiB.
- Timeouts de invocación del CLI, con continuación de la cola al excederlos; el de `speech say` crece con el texto, porque cubre síntesis y reproducción.
- Tope común de 2 oraciones y 500 caracteres para toda locución dinámica, también la del modo `llm`.
- Modos de mensaje `local` (por defecto, offline) y `llm` (Gemini, opt-in con `GEMINI_API_KEY`).
- Saneamiento del texto para voz antes de narrar o de enviarlo a un proveedor externo.
- Notificaciones de escritorio con icono por evento y registro del AUMID en Windows.
- Configuración en `/config` (`userConfig`): `voiceEnabled`, `notificationsEnabled`, `messageMode` y `enhancedTranscript`. Apagar la voz descarta lo pendiente de narrar.
- `narrate-ctl` con `status`, `say` y `presynth [--force]`.
- Instalación guiada `/evolutivex-agents:install` y skill `/evolutivex-agents:narrate`.
- Transcript enriquecido opt-in (`/config` → `enhancedTranscript`): recuadros con la hora de inicio y la duración de cada bloque del transcript, hora en Spinner y TurnDuration, contadores en vivo y persistencia local para sesiones reanudadas. Tres fallos propios seguidos lo apagan en la sesión con un toast que indica la causa.
- Tests del transcript enriquecido con el kit oficial de Claude Code (`npm run test:transcript`), también en CI.
- Regla de complejidad cognitiva (SonarJS) de 15 como máximo en `src/**`.
- Plantilla de reporte de errores en `.github/ISSUE_TEMPLATE/bug_report.md`.
- Licencia MPL-2.0.

[No publicado]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/releases/tag/v0.1.0
