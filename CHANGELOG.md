# Changelog

Todos los cambios notables de **EvolutiveX Agents** se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [0.1.0] — 2026-11-03

Verificado contra **AI Voice-InterConnector v0.42.0** en **Windows 11**.

### Añadido

- Configuración unificada en `/config` (`userConfig`): `voiceEnabled`, `notificationsEnabled`, `messageMode` y `enhancedTranscript`. `config.json` eliminado.
- Rotación de `worker.log` por tamaño (512 KiB) y antigüedad (14 días); máximo 2 archivos y 1 MiB.
- Protección del transcript enriquecido: 3 fallos propios seguidos del mismo handler apagan el transcript en la sesión con un toast; handlers ceden a lo nativo, reloj detenido, contadores vacíos.
- Regla de complejidad cognitiva (SonarJS) ≤ 15 en `src/**`.
- Tipado y tests del transcript enriquecido en CI (`validate-manifest`).

### Modificado

- `narrate-ctl` mantiene solo `status`, `say` y `presynth [--force]`. Toggles y `mode` se configuran en `/config`; `status` remite a `/config`.
- `onStep` y `onAppend` refactorizados por debajo del tope de complejidad 15.
- `worker.log` rotado antes de cada escritura; `worker.log.1` caduca a 14 días.

### Eliminado

- `config.json`, `updateConfig`, `configPath`, `readFileConfig`, `FileConfig`.
- Subcomandos `voice-on`, `voice-off`, `notifications-on`, `notifications-off`, `mode` de `narrate-ctl`.

[0.1.0]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/compare/v0.1.0...HEAD
[No publicado]: https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/commits/main
