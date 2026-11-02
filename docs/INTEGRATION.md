# Integración con AI Voice-InterConnector

Este documento describe la integración de **Agent Voice-InterConnector** con el motor de síntesis **AI Voice-InterConnector**, desde la perspectiva del **plugin (el consumidor)**.

La contraparte, escrita desde la perspectiva del motor, está en su contrato público:
[docs/CLI/CONTRACT.md §12 «Contratos externos»](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/v0.37.4/docs/CLI/CONTRACT.md#12-contratos-externos)
(tag `v0.37.4`).

## Tabla de contenidos

- [Rol en el sistema de narración](#rol-en-el-sistema-de-narración)
- [Contrato: solo la CLI pública](#contrato-solo-la-cli-pública)
- [Superficies del CLI que consume](#superficies-del-cli-que-consume)
- [Cómo lo usan los hooks](#cómo-lo-usan-los-hooks)
- [Requisitos sobre el motor](#requisitos-sobre-el-motor)
- [Degradación y no intrusión](#degradación-y-no-intrusión)
- [Troubleshooting](#troubleshooting)
- [Estabilidad del contrato](#estabilidad-del-contrato)

## Rol en el sistema de narración

El sistema de narración por voz tiene dos componentes con repositorios y ciclos de vida independientes:

| Componente                            | Repositorio                                                                                                  | Rol                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Agent Voice-InterConnector** (este) | [`Agent-Voice-InterConnector`](https://github.com/CristianRojas-SoftwareEngineer/Agent-Voice-InterConnector) | **Cliente**: detecta eventos de la sesión de Claude Code, construye un mensaje corto y pide su síntesis. |
| **AI Voice-InterConnector**           | [`AI-Voice-InterConnector`](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector)       | **Motor**: sintetiza voz 100 % offline y expone una CLI pública.                                         |

El plugin **depende** de AI Voice-InterConnector; AI Voice-InterConnector **no** conoce ni depende del plugin. La relación es unidireccional.

## Contrato: solo la CLI pública

El único punto de acoplamiento es el ejecutable `ai-voice-interconnector` en el `PATH` y su interfaz de línea de comandos. El plugin **no** enlaza ni importa nada del motor, no comparte código ni necesita su árbol fuente — es un consumidor externo idéntico a cualquier script de usuario. Esto mantiene ambos proyectos desacoplados: mientras la CLI sea estable, cada uno evoluciona a su ritmo.

## Superficies del CLI que consume

| #   | Superficie                                                                            | Uso en el plugin                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ai-voice-interconnector speech say --text "<msg>" --daemon`                          | Síntesis y reproducción de cada locución dinámica. **Requiere el daemon vivo** (exit `5` si está caído; no lo arranca solo); por eso el plugin lo mantiene caliente.                                                                                                                                                                                                                                                                                  |
| 2   | `ai-voice-interconnector doctor --json`                                               | Verificación del entorno al iniciar sesión. El motor emite **exactamente un** objeto JSON, con `checks` (una entrada `{name, ok, detail}` por chequeo) y `failed` (`string[]` con los nombres fallidos): el entorno está sano si `failed` está vacío. Exit `0` = sano; exit `1` = veredicto negativo (mismo reporte, sin objeto `error`); exit `1` con `reason: "doctor_failed"` = fallo del comando (contrato `docs/CLI/CONTRACT.md §12` del motor). |
| 3   | `ai-voice-interconnector daemon status --json`                                        | Comprueba si el daemon corre antes de intentar levantarlo. El motor emite `{"daemon":"running"}` o `{"daemon":"stopped"}`, con `degraded` cuando hay residuos; el plugin trata una invocación fallida como estado incierto.                                                                                                                                                                                                                           |
| 4   | `ai-voice-interconnector daemon start`                                                | Levanta el daemon de forma desanclada para dejar el modelo en memoria.                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | `ai-voice-interconnector speech synthesize --text "<aviso>" --label <label> --daemon` | Pre-síntesis única de los avisos estáticos (`narrate-ctl presynth`, invocado por la instalación guiada). El label es un slug semántico fijo; exit `6` (label ya existe) se trata como «ya pre-sintetizado» (idempotencia). `narrate-ctl presynth --force` añade `--force` para sobrescribir el WAV existente (re-sync tras cambiar una frase). Exit `5` daemon caído, `4` modelo ausente.                                                             |
| 6   | `ai-voice-interconnector speech play --label <label>`                                 | Reproducción instantánea de un aviso pre-sintetizado (acuse de `UserPromptSubmit` y fallbacks estáticos), **sin modelo ni daemon**. Exit `3` = cache miss (aviso no pre-sintetizado): se registra en `worker.log` y el turno queda sin audio, sin re-sintetizado ni fallback. Exit `2` = label ilegal.                                                                                                                                                |

> **Canales y códigos de salida.** `stdout` es el canal del resultado —texto o envelope `--json`— y `stderr` es el canal del progreso, los avisos y las trazas. El plugin no parsea `stderr` ni depende del cierre `[ok]`/`[error]`. `daemon status --json` informa el estado por su envelope y sale 0; el plugin trata una invocación fallida como estado incierto y no arranca el daemon. `daemon start` exige los cinco modelos de arranque; el plugin lo lanza desanclado y no observa su resultado.

## Cómo lo usan los hooks

- **`UserPromptSubmit`** → `narrate-worker` reproduce el acuse fijo pre-sintetizado
  («Procesando con Claude») con `speech play --label …`: sin LLM, sin resumen y
  sin daemon en la ruta caliente.
- **`Stop`** → única ruta de locución dinámica. `narrate-worker` resume el
  `last_assistant_message` del payload (y **solo** ese campo: ni transcript ni
  historial) vía LLM y llama a `speech say --text … --daemon`. Si el mensaje
  final no tiene material narrable —porque era solo un bloque de código, que el
  saneo descarta—, o el LLM cae, degrada al resumen local acotado (las dos
  primeras oraciones del texto saneado, con 500 caracteres como freno de
  emergencia) o al aviso estático pre-sintetizado (`speech play`). El worker
  corre desanclado; nunca bloquea el turno.
- **`SubagentStop` / `StopFailure` / `Notification`** → reproducen su anuncio
  pre-sintetizado con `speech play --label …`: sin LLM ni síntesis por evento. Para
  `Notification` el mensaje específico sigue visible en pantalla.
- **`SessionStart`** → `health-check` corre `doctor --json` y decide por el exit y
  el reporte. Solo tras un diagnóstico sano (exit `0` y `failed` vacío) consulta
  `daemon status --json`; si el resultado es `stopped` limpio, levanta el daemon con
  un **único** `daemon start` desanclado (fire-and-forget). Un resultado `degraded`
  o incierto no arranca nada y avisa vía `systemMessage` remitiendo a
  `daemon status --json`; `warm_failed` avisa sin reiniciar, y `warming` no bloquea
  ni espera. Si el entorno falla (exit `1`, o `reason: "doctor_failed"`, o falta el
  CLI), avisa vía `systemMessage` y no hace nada más. Termina siempre con exit `0`.
- **Instalación** (`/agent-voice-interconnector:install`) → `narrate-ctl presynth`
  pre-sintetiza los anuncios del catálogo (`src/message/static-announcements.ts`) con
  `speech synthesize … --daemon`, una sola vez y de forma idempotente.

La resolución del ejecutable la hace `lib/resolve-cli.ts`, que escanea el `PATH` (honrando `PATHEXT` en Windows).

## Requisitos sobre el motor

Para que la narración funcione, en la máquina del usuario debe existir:

1. `ai-voice-interconnector` en el `PATH`, instalado con el instalador publicado en
   la release del tag (`install.sh` para Linux/macOS e `install.ps1` para Windows).
   El motor expone el grupo `speech` (superficies 1, 5 y 6) que el plugin consume.
2. Los seis modelos de la selección de `setup`, descargados con
   `ai-voice-interconnector setup` (los instaladores lo encadenan):
   `qwen3-tts-0.6b` (CustomVoice), `qwen3-tts-0.6b-base` (Base), `opus-mt-es-en`,
   `opus-mt-en-es`, `parakeet-tdt-v3` y `dpdfnet8`. El daemon requiere los cinco
   primeros para arrancar; `dpdfnet8` es opcional para ese arranque y necesario
   para `--denoise`. `doctor` comprueba la selección completa. La voz Base es requerida por las voces
   clonadas, incluida `default`. La narración usa la voz de fábrica `default` y no
   pasa `--voice`.

El comando `/agent-voice-interconnector:install` del plugin guía ambos pasos.

## Degradación y no intrusión

Si el CLI no está en el `PATH`, el modelo no está en caché, o el daemon no responde, el plugin **degrada en silencio**: no reproduce audio, no bloquea ni retrasa el turno de Claude Code, y (solo en `SessionStart`) emite un aviso informativo. La ausencia del motor nunca es un error para el usuario de Claude Code.

El canal de **notificaciones de escritorio** (`dist/notification-hook.js`, `dist/notification-cli.js` y `dist/notification-register.js`) es completamente independiente del motor `ai-voice-interconnector` y de su daemon: se controla por separado con `notificationsEnabled` (`narrate-ctl.js notifications-on` / `notifications-off`, frente a `voiceEnabled` con `voice-on` / `voice-off`) y funciona aunque el motor de voz no esté instalado o esté detenido.

## Troubleshooting

**Logs.** Son dos juegos distintos y no conviene mezclarlos: `worker.log` es el log
**del plugin** (el worker registra ahí sus exits, avisos y fallos, incluidos los
timeouts de invocación al CLI), mientras que los logs **del motor** son ficheros
propios en
`data/logs/<familia>_<token>_<ms>.log` (p. ej. `daemon_…`, `qwen3-tts_…`). Para
afinar el nivel de detalle del daemon puede configurarse `RUST_LOG`; no se promete
ningún `status.path.log`, que no forma parte del contrato.

**Locuciones corruptas.** Tras un diagnóstico manual, el remedio seguro es quitar
la locución con `speech remove --label <etiqueta> [--voice <voz>]` y re-sintetizarla
con `narrate-ctl presynth`. No se recomienda `cleanup --all` ni ningún
`doctor --repair` automático.

## Estabilidad del contrato

El plugin asume estables los flags y el esquema JSON de las seis superficies de arriba. El contrato del motor (`docs/CLI/CONTRACT.md §12`, contrastado con v0.37.4) publica esas seis superficies: `speech say`, `speech synthesize`, `speech play`, `doctor --json`, `daemon status --json` y `daemon start`. `doctor` es integral: incluye instalación, receipt, PATH, residuos y modelos, también en canal `unmanaged`; no es una comprobación parcial de recursos. El plugin solo continúa si el veredicto completo es sano. `degraded` o estado incierto impiden el arranque y `warm_failed` se informa sin reiniciar.

La [propuesta de clonación de voz](specs/VOICE_CLONING.md) amplía el contrato previsto con `voice clone`, `voice list`, `voice remove`, `--voice`, `--warm-voice` y `--denoise` optativo. Estas superficies **todavía no son consumidas por el plugin**. La corrección del push-to-talk sin variable de entorno está publicada en v0.37.4.
