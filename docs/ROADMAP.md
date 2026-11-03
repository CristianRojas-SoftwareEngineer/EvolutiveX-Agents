# Roadmap — EvolutiveX Agents

Este es el roadmap vivo del plugin y mira hacia adelante: reúne las direcciones
que todavía no están implementadas. Lo ya construido y lo descartado no se
conserva aquí; su relato vive en el historial de git. No hay fechas ni
compromisos: cada release revisa, promueve o retira ideas según el uso real y el
feedback de la beta.

## Consolidar la beta (0.2.x)

El foco inmediato es cerrar las aristas que aparecen cuando el plugin se usa de
verdad: ráfagas de hooks, un daemon que falla o tarda, y la necesidad de
diagnosticar sin abrir una consola. La prioridad es que la narración siga siendo
invisible cuando todo va bien y fácil de reparar cuando no.

### Robustez y recuperación

- Reintentar `daemon start` con backoff cuando el daemon queda en `warming` y
  deriva en `warm_failed`.
- Distinguir en el aviso de `SessionStart` entre modelo ausente
  (`model_missing`, exit 4) y daemon inalcanzable (`daemon_unreachable`, exit 5).
- Revisar el timeout de la ruta LLM (hoy 8 s) para que la caída a `local` sea más
  rápida cuando no hay conectividad.

### Diagnóstico y control

- `narrate-ctl test`: smoke test audible que recorre las superficies en modo
  local sin abrir una sesión de Claude Code.
- Modo `verbose` en `narrate-ctl`: proveedor usado, latencia y, si aplica,
  consumo de tokens.
- Comando `doctor` del plugin: CLI del motor, modelos, daemon, clave de entorno y
  preferencias en una sola pasada.
- `narrate-ctl status` con el estado de la cola FIFO existente (`pendientes`, worker activo).

### Configuración

- Timeouts por hook, en lugar de los valores fijos de `hooks/hooks.json`.
- Perfiles de voz por evento (`voice-stop`, `voice-notification`, …).
- Umbral de oraciones de la degradación local configurable.
- Activación selectiva de hooks sin editar `hooks/hooks.json`.

### Pruebas

- Smoke test E2E automatizado en CI sobre Linux, Windows y macOS.
- Ejercitar las cinco superficies de narración y el health-check en los tres
  sistemas, no solo la lógica pura.

## Narración enriquecida e integración (0.3.x)

Con la beta estable, el siguiente salto es que la locución tenga más contexto sin
perder la fidelidad al turno ni la privacidad por defecto.

### Más contexto, siempre opt-in

- Inyectar `cwd`, branch y últimos archivos modificados en el prompt del LLM.
- Narrar diffs en modo local determinista: archivos y líneas cambiadas.
- Anuncios de `Notification` con el tipo de permiso (bash/read/write).
- Si el contexto crece, cachear y limitar la cola de mensajes para que el costo
  no dependa del tamaño del transcript.

### Voz y streaming

- `speech say --stream` para reproducir mientras el motor sintetiza.
- Integrar en el plugin la clonación de voz que ya expone el motor, según la
  [especificación propuesta](specs/VOICE_CLONING.md).
- Mostrar la operación en curso (síntesis, clonación, doblaje) en `status`.

### Distribución

- Publicar en el marketplace de Claude.ai con ficha, screenshots y validación
  estricta.
- Avisar en `SessionStart` cuando haya una versión nueva del plugin.
- Ofrecer instalación nativa vía Homebrew tap o Scoop bucket.

## Gobernanza del motor

- Consultar `ai-voice-interconnector version` en `SessionStart` y avisar —sin
  bloquear— si el motor instalado es distinto del verificado (`engine.aiVoiceInterConnector` de `package.json`).
- Automatizar en CI la detección de un release del motor más nuevo que
  `engine.aiVoiceInterConnector` (hoy se detecta bajo demanda con la skill de
  desarrollo `/sync-with-engine`).

## Ideas en incubación

| Idea                                                               | Complejidad | Valor                | Bloqueantes                     |
| ------------------------------------------------------------------ | ----------- | -------------------- | ------------------------------- |
| TTS local de respaldo (piper/coqui) si el motor no está disponible | Alta        | Offline total        | Tamaño del bundle, licencias    |
| Narración multi-idioma (detectar el idioma del turno)              | Media       | Equipos distribuidos | Soporte cross-lingual del motor |
| Hooks `PreToolUse`/`PostToolUse` para narrar herramientas          | Baja        | Observabilidad       | Ruido potencial alto            |
| Dashboard web de métricas (latencia, proveedor, errores)           | Media       | Debugging            | Privacidad, almacenamiento      |
| Extensión de VS Code independiente de Claude Code                  | Alta        | Alcance              | Arquitectura distinta           |

## Criterios para 1.0.0

- Motor AI Voice-InterConnector en `v1.0.0`, publicado y estable.
- Plugin sin deprecaciones ni APIs experimentales.
- Smoke test E2E automatizado en CI sobre Linux, Windows y macOS.
- Documentación completa: usuario, desarrollo, arquitectura y contrato.
- Publicación en el marketplace de Claude.ai con validación estricta.
- Changelog limpio, con cada entrada vinculada a su PR o issue.

## Mantenimiento

Cada release revisa este documento según `docs/RELEASING.md` §Después del tag:
las ideas implementadas o descartadas se retiran (su historial queda en git) y
las nuevas que surjan del uso real se incorporan a la sección correspondiente.

La política de versionado y el corte verificado del motor viven en `docs/RELEASING.md` (§Modelo de versionado).
