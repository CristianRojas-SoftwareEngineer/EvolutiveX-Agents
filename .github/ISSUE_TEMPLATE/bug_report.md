---
name: Informe de error
about: Reportar un fallo del plugin EvolutiveX Agents
title: "[BUG] "
labels: bug
assignees: ""
---

## Información del entorno

- **Versión de Claude Code** (ejecuta `claude --version`):
- **Versión de AI Voice-InterConnector** (ejecuta `ai-voice-interconnector version`):
- **Sistema operativo** (Windows 11 / Linux / macOS + versión):

## Salida de diagnóstico del motor

Ejecuta `ai-voice-interconnector doctor --json` y pega la salida aquí:

```json
<pegar la salida completa>
```

## Logs del plugin

Ruta del state dir según tu SO:

| SO      | Ruta                                                                    |
| ------- | ----------------------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\evolutivex-agents\worker.log` y `.1`                    |
| Linux   | `${XDG_STATE_HOME:-~/.local/state}/evolutivex-agents/worker.log` y `.1` |
| macOS   | `~/Library/Application Support/evolutivex-agents/worker.log` y `.1`     |

Pega las **últimas 30 líneas relevantes** de `worker.log` y, si existe, de `worker.log.1`:

```
<pegar líneas de worker.log>
```

## Toast del transcript enriquecido (si apareció)

Si el transcript enriquecido se desactivó solo, copia el texto exacto del toast que apareció:

```
<texto del toast>
```

## Pasos para reproducir

1.
2.
3.

## Comportamiento esperado

## Comportamiento real

## Información adicional

Capturas de pantalla, configuración extra, etc.
