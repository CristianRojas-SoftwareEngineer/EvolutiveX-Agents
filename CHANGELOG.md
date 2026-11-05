# Changelog

Todos los cambios notables de **EvolutiveX Agents** se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

## [0.2.1] — 2026-11-05

### Corregido

- Un despacho de notificación fallido (`dispatch_failed`) ya no se pierde si el directorio de estado todavía no existe: `notification.log` lo crea. El motivo del fallo se registra siempre en una sola línea.
- Documentación alineada con el despacho desanclado (`INTEGRATION`, `VOICE_CLONING` y `RELEASING`).

## [0.2.0] — 2026-11-05

### Añadido

- `notification.log` en el _state dir_: cada entrega de un toast deja una línea con el evento, el resultado, la duración y el error, y un despacho fallido queda como `dispatch_failed`. Comparte la rotación con `worker.log` (512 KiB, 14 días, como máximo dos archivos).
- Diagnóstico del notificador en `narrate-ctl status`: las líneas `notificador:` (SnoreToast y registro AUMID en Windows, `terminal-notifier` en macOS, `notify-send` en Linux) y `notification log:` con su ruta.
- Reconciliación automática del registro AUMID en Windows en cada `SessionStart`, antes de mostrar el toast, para que apunte a la carpeta de la versión instalada tras `claude plugin update`.
- Nueva entrada interna `dist/notification-deliver.js` y reglas de arquitectura verificadas por `npm run check-dist`: el bundle del hook no contiene `node-notifier`, `commander` ni el adaptador, y los bundles de notificaciones no contienen `src/voice/`.
- Sincronización con **AI Voice-InterConnector v0.44.0**: `presynth` usa `--skip-existing` para la idempotencia explícita (exit 0, status "skipped") y trata cualquier código ≠ 0 como fallo; `invalid_voice_name` sustituye a `invalid_identifier` como reason de voz ilegal en `narrate-worker.ts` y `voice-problem.ts`. La versión mínima y la verificada pasan a 0.44.0.
- Clonado de tu voz desde un WAV o el micrófono con el comando `/evolutivex-agents:voice` (`clone`, `list` y `remove`): se guarda como la voz `custom`, con un nombre de presentación opcional (`--display-name`), y pre-sintetiza sus anuncios; la instalación guiada lo ofrece de forma opcional. Requiere AI Voice-InterConnector 0.44.0 o posterior.
- Selector de la voz activa en `/config` → `evolutivex-agents.voice` (`default`, `ryan`, `vivian` o `custom`; `default` por defecto): toda la narración la usa de forma explícita, y un cambio se oye desde el siguiente evento.
- `SessionStart` arranca el daemon precalentando la voz activa y avisa si la voz no existe (por ejemplo, `custom` sin clonar) o su valor no es una de las opciones, sin caer a `default`. Con la voz ausente o no comprobable y el daemon parado, lo arranca precalentando `default` para que clonar y pre-sintetizar funcionen; la narración sigue pidiendo la voz elegida.
- Notificación de escritorio de los problemas de voz: si la voz activa no existe, no tiene sus anuncios o su nombre no es válido, el worker lo avisa con el remedio una sola vez por problema (respeta `notificationsEnabled`) y vuelve a avisar si reaparece tras una narración correcta.
- `narrate-ctl` con `voice list|clone|remove`, `--voice` en `say` y `presynth`, y la voz activa en `status`; las operaciones manuales de voz se excluyen entre sí.
- La instalación guiada ofrece pre-sintetizar también los anuncios de `ryan` y `vivian` (alrededor de 1 minuto y 1 MB cada una), antes de los de `default` para dejarla caliente en el daemon.
- `narrate-ctl say` traduce los fallos del motor a un remedio, y con la voz `custom` sin clonar, `say` y `presynth` remiten a `/evolutivex-agents:voice clone`.

### Cambiado

- Toda entrega de toasts pasa por un único núcleo (`notification-deliver`), también la CLI pública y el aviso de problemas de voz. Las utilidades de proceso y las primitivas de nombre de voz pasan a `src/lib/`, que ya no depende de `src/voice/`. La CLI `notification-cli.js` conserva sus flags, salida y códigos de salida.
- Sincronizado con AI Voice-InterConnector v0.44.0, que pasa a ser la versión verificada y la mínima de la gestión de voces. Re-clonar `custom` con `--force` reemplaza también sus locuciones guardadas: el motor las borra porque se grabaron con la voz anterior, `voice clone` las nombra y vuelve a pre-sintetizar los seis anuncios, y el daemon recarga la voz re-clonada en lugar de seguir con la anterior. `narrate-ctl` pasa `--yes` junto a `--force`, porque el comando ya confirmó el reemplazo con el usuario.
- La pre-síntesis trata el exit 6 `voice_changed` (la voz cambió mientras se sintetizaba y el motor no guardó la locución) como un fallo con su remedio, no como un anuncio ya pre-sintetizado.

### Corregido

- Al cerrar una sesión aparecía `SessionEnd hook [...] failed: Hook cancelled`: el hook de notificaciones esperaba a que terminara el backend del sistema (SnoreToast, hasta 12,5 s) y `SessionEnd` es síncrono con un límite de 3 s. Ahora el hook solo decide y despacha la entrega a un proceso desanclado, y termina en milisegundos.
- En el modo `llm`, el resumen del turno parafrasea el mensaje del asistente en lugar de relatarlo: dice «Hola, ¿qué tal?» y no «Te he saludado y te he preguntado qué tal», con la misma intención que el original.
- Transcript enriquecido: si el plugin fallaba al registrar una herramienta antes de ejecutarla, su bloque mostraba un contador «en curso» que no se detenía y el reloj seguía haciendo un tic por segundo.

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

[No publicado]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/releases/tag/v0.1.0
