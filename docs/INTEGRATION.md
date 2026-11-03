# Integración con AI Voice-InterConnector

Este documento describe la integración de **EvolutiveX Agents** con el motor de síntesis **AI Voice-InterConnector**, desde la perspectiva del **plugin (el consumidor)**.

La contraparte, escrita desde la perspectiva del motor, está en su contrato público:
[docs/CLI/CONTRACT.md §12 «Contratos externos»](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/v0.42.0/docs/CLI/CONTRACT.md#12-contratos-externos)
(tag `v0.42.0`).

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

| Componente                   | Repositorio                                                                                            | Rol                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **EvolutiveX Agents** (este) | [`EvolutiveX-Agents`](https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents)             | **Cliente**: detecta eventos de la sesión de Claude Code, construye un mensaje corto y pide su síntesis. |
| **AI Voice-InterConnector**  | [`AI-Voice-InterConnector`](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector) | **Motor**: sintetiza voz 100 % offline y expone una CLI pública.                                         |

El plugin **depende** de AI Voice-InterConnector; AI Voice-InterConnector **no** conoce ni depende del plugin. La relación es unidireccional.

## Contrato: solo la CLI pública

El único punto de acoplamiento es el ejecutable `ai-voice-interconnector` en el `PATH` y su interfaz de línea de comandos. El plugin **no** enlaza ni importa nada del motor, no comparte código ni necesita su árbol fuente — es un consumidor externo idéntico a cualquier script de usuario. Esto mantiene ambos proyectos desacoplados: mientras la CLI sea estable, cada uno evoluciona a su ritmo.

## Superficies del CLI que consume

| #   | Superficie                                                                                                                                     | Uso en el plugin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ai-voice-interconnector speech say --text "<msg>" --voice <voz> --daemon --json`                                                              | Síntesis y reproducción de cada locución dinámica con la voz anotada en el ítem de la cola (`narrate-ctl say` la usa sin `--json`, con la voz de `--voice` o de la caché). **Requiere el daemon vivo** (exit `5` `daemon_unreachable` si está caído; no lo arranca solo); por eso el plugin lo mantiene caliente. Ante cualquier fallo, el worker registra en `worker.log` el código y, si el `reason` es conocido (`voice_not_found`, `no_output_device`, `audio_backend_unavailable`, `playback_failed`, `model_missing`, `daemon_unreachable`), su causa y remedio; `voice_not_found` nombra la voz y remite a `/config`.                                                                            |
| 2   | `ai-voice-interconnector doctor --json`                                                                                                        | Verificación del entorno al iniciar sesión. El motor emite **exactamente un** objeto JSON, con `checks` (`{name, ok, detail}` por chequeo) y `failed` (nombres fallidos). Exit `0` con `failed` vacío = sano; exit `1` = veredicto negativo (mismo reporte, sin objeto `error`); exit `1` con `reason: "doctor_failed"` = fallo del comando. Como `doctor` es integral, el plugin aplica un **gate de recursos**: solo `models_provisioned` y `onnx_runtime` impiden calentar el daemon; `install_receipt`, `path_resolves`, `path_duplicates`, `pending_artifacts` o un check desconocido se avisan sin bloquear (el §12 del motor pide separar las gates de bootstrap).                               |
| 3   | `ai-voice-interconnector daemon status --json`                                                                                                 | Comprueba si el daemon corre antes de intentar levantarlo. El motor emite `{"daemon":"running"}` o `{"daemon":"stopped"}`, con `degraded` cuando hay residuos; el plugin trata una invocación fallida como estado incierto.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | `ai-voice-interconnector daemon start --warm-voice <voz>`                                                                                      | Levanta el daemon de forma desanclada para dejar el modelo en memoria, precalentando la voz activa (también `default`, de forma explícita). Falla al instante con exit `3` `voice_not_found` si la voz no existe, por eso `SessionStart` la valida antes con `voice list --json`.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | `ai-voice-interconnector speech synthesize --text "<aviso>" --label <label> --voice <voz> --daemon --json`                                     | Pre-síntesis de los avisos estáticos de una voz (`narrate-ctl presynth [--voice <voz>]`, invocado por la instalación guiada y al final de `voice clone`). El label es un slug semántico fijo; solo el exit `6` con `reason: label_exists` se trata como «ya pre-sintetizado» (idempotencia). `--force` sobrescribe el WAV existente (re-sync tras cambiar una frase o re-clonar). Exit `3` `voice_not_found`, `5` daemon caído, `4` modelo ausente.                                                                                                                                                                                                                                                     |
| 6   | `ai-voice-interconnector speech play --label <label> --voice <voz> --json`                                                                     | Reproducción instantánea de un aviso pre-sintetizado (acuse de `UserPromptSubmit` y fallbacks estáticos) con la voz del ítem, **sin modelo ni daemon**. Exit `3` con cuatro causas: `speech_not_found` (aviso no pre-sintetizado para esa voz → `presynth --voice <voz>`), `voice_not_found` (la voz no existe → elegir otra en `/config`), `no_output_device` y `audio_backend_unavailable` (entorno de audio del sistema); exit `1` `playback_failed`; exit `2` `invalid_identifier` (nombre de voz ilegal; las etiquetas del catálogo son fijas), con su pista en `worker.log`. El worker registra el código y la causa en `worker.log`, y el turno queda sin audio, sin re-sintetizado ni fallback. |
| 7   | `ai-voice-interconnector voice list --json`                                                                                                    | Listado de voces (`{voices: string[]}`; exit `0`, `1` o `17` `lifecycle_locked`). Lo usan `narrate-ctl voice list`, que marca las de fábrica y la activa, y `SessionStart`, que valida una voz activa distinta de `default` (≤2 s); un listado fallido o ilegible es un diagnóstico incierto.                                                                                                                                                                                                                                                                                                                                                                                                           |
| 8   | `ai-voice-interconnector voice clone --name custom (--speech-reference <wav> \| --mic [--duration <s>]) [--force] [--denoise] --daemon --json` | Clonado (`narrate-ctl voice clone`), siempre con el daemon y siempre en la voz `custom`. Salida `{name, speech, precomputed}`. Códigos: `1` `voice_clone_failed`/`io_error`/`denoise_unsupported`/`denoise_failed`; `2` `invalid_voice_name`/`invalid_audio`/`audio_too_long`/`empty_audio`/`usage_error`; `3` `audio_not_found`/`no_input_device`/`audio_backend_unavailable`; `4` `model_missing`; `5` `daemon_unreachable`; `6` `voice_exists`/`denoise_busy`; `10` `transcription_failed`; `17` `lifecycle_locked`. El plugin hereda stdin y stderr (push-to-talk y progreso) y captura stdout; rechaza antes las voces de fábrica, que el motor sí permite sobrescribir con `--force`.             |
| 9   | `ai-voice-interconnector voice remove --name <n> --yes --json`                                                                                 | Borrado (`narrate-ctl voice remove`), con salida `{status, voice, removed_speech}`. Códigos: `1` `io_error`; `2` `invalid_voice_name`/`cannot_remove_default`/`confirmation_required`; `3` `voice_not_found`; `17` `lifecycle_locked`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 10  | `ai-voice-interconnector version --json`                                                                                                       | Versión mínima de la gestión de voces (`version` ≥ `0.42.0`), comprobada solo por las operaciones `voice *` de `narrate-ctl` (timeout de 5 s), nunca en los hooks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

> **Canales y códigos de salida.** `stdout` es el canal del resultado —texto o envelope `--json`— y `stderr` es el canal del progreso, los avisos y las trazas. El plugin no parsea `stderr` ni depende del cierre `[ok]`/`[error]`. `daemon status --json` informa el estado por su envelope y sale 0; el plugin trata una invocación fallida como estado incierto y no arranca el daemon. `daemon start` exige los cinco modelos de arranque; el plugin lo lanza desanclado y no observa su resultado. Con `--json`, toda salida ≠ 0 emite por `stdout` el payload `{"error", "reason"}`; el plugin lo lee para diagnosticar `speech play` y `speech say` en el worker (acotado a 64 KiB) y para interpretar los errores de `speech synthesize` y `voice *` en `narrate-ctl`; decide siempre por el código y trata un `reason` desconocido como ausente, con un mensaje genérico que conserva el exit. El plugin no lee `schema_version` (hoy `"6"` en el envelope de la CLI).

## Cómo lo usan los hooks

La voz activa es el campo `voice` de `/config` (`default` si no está fijado). El launcher la anota en cada ítem que encola y el worker narra con la voz del ítem, así que un cambio en `/config` se oye desde el siguiente evento. El launcher y `SessionStart` escriben además la caché `active-voice` del _state dir_, que `narrate-ctl` usa cuando no recibe `--voice` (la herramienta de shell no recibe `/config`). No hay fallback a `default`: una voz inexistente deja el turno sin audio y queda registrada en `worker.log`.

- **`UserPromptSubmit`** → `narrate-worker` reproduce el acuse fijo pre-sintetizado
  («Procesando con Claude») con `speech play --label … --voice <voz> --json`: sin LLM, sin resumen y
  sin daemon en la ruta caliente.
- **`Stop`** → única ruta de locución dinámica. `narrate-worker` resume el
  `last_assistant_message` del payload (y **solo** ese campo: ni transcript ni
  historial) vía LLM y llama a `speech say --text … --voice <voz> --daemon --json`. Si el mensaje
  final no tiene material narrable —porque era solo un bloque de código, que el
  saneo descarta—, o el LLM cae, degrada al resumen local acotado (las dos
  primeras oraciones del texto saneado, con 500 caracteres como freno de
  emergencia) o al aviso estático pre-sintetizado (`speech play`). La salida del
  LLM pasa por el mismo recorte, así que ninguna locución supera los 500
  caracteres. Como `speech say` sintetiza la locución completa antes de
  reproducirla, su timeout crece con el texto (30 s + 0,4 s por carácter); al
  vencer, el daemon cancela la síntesis en curso. El worker corre desanclado;
  nunca bloquea el turno.
- **`SubagentStop` / `StopFailure` / `Notification`** → reproducen su anuncio
  pre-sintetizado con `speech play --label … --voice <voz> --json`: sin LLM ni síntesis por evento. Para
  `Notification` el mensaje específico sigue visible en pantalla.
- **`SessionStart`** → `health-check` escribe la caché de la voz activa y, si su
  valor no es una de las opciones de `/config` (`default`, `ryan`, `vivian`,
  `custom`), avisa vía `systemMessage` sin consultar al motor.
  Luego corre `doctor --json` y decide por el exit y el reporte con un gate de
  recursos. Si falla `models_provisioned` u `onnx_runtime`, o `doctor_failed`, o
  falta el CLI, avisa vía `systemMessage` y no toca el daemon. Si el reporte es
  sano o solo fallan checks de instalación (`install_receipt`, `path_*`,
  `pending_artifacts`), consulta `daemon status --json`. Con `running` o
  `stopped` limpio y una voz activa distinta de `default`, la valida con
  `voice list --json`: si no existe, o el listado falla, avisa y no arranca el
  daemon. Con `stopped` limpio y la voz existente levanta el daemon con un
  **único** `daemon start --warm-voice <voz>` desanclado; un daemon corriendo no
  se reinicia aunque tenga caliente otra voz. `degraded` o incierto no arrancan
  nada y avisan remitiendo a `daemon status --json`; `warm_failed` avisa sin
  reiniciar y `warming` no bloquea. El aviso de checks de instalación y el del
  daemon o la voz se combinan en un **único** `systemMessage`. Un deadline
  global de 28 s acota cada consulta al motor bajo el timeout de 30 s del hook.
  Termina siempre con exit `0`.
- **Instalación** (`/evolutivex-agents:install`) → `narrate-ctl presynth`
  pre-sintetiza los anuncios del catálogo (`src/voice/message/static-announcements.ts`) con
  `speech synthesize … --voice default --daemon --json`, una sola vez y de forma
  idempotente, y ofrece clonar la voz del usuario.

## Operaciones manuales de voz

`narrate-ctl` expone `voice list`, `voice clone` y `voice remove`, y `--voice` en `say` y `presynth`; el comando `/evolutivex-agents:voice` y la skill `narrate` las orquestan. Las operaciones `voice *` comprueban antes la versión mínima con `version --json`. `voice clone`, `voice remove` y `presynth` se excluyen entre sí con el directorio `voice-operation.lock` del _state dir_ (exit `6` si otra operación lo tiene); los hooks y el worker nunca lo toman. `voice clone` clona siempre en `custom` —la única voz propia, porque el selector de `/config` solo admite opciones fijas—, guarda el nombre de presentación de `--display-name` en `custom-display-name` del _state dir_ y termina con `presynth --voice custom --force` dentro del mismo bloqueo; solo indica elegir `custom` en `/config` si los seis anuncios terminaron bien. El plugin rechaza sin invocar al motor `--mic` sin `--duration` sin terminal interactiva, un nombre de presentación inválido y `voice remove` sin `--yes`; el resto de las validaciones son del motor. El diseño completo está en la [especificación del clonado de voz](specs/VOICE_CLONING.md).

La resolución del ejecutable la hace `src/voice/resolve-cli.ts`, que escanea el `PATH` (honrando `PATHEXT` en Windows).

## Requisitos sobre el motor

El plugin está verificado contra **AI Voice-InterConnector v0.42.0** (soporte exclusivo a ese corte; fuente única: `engine.aiVoiceInterConnector` en `package.json`). Para que la narración funcione, en la máquina del usuario debe existir:

1. `ai-voice-interconnector` en el `PATH`, instalado con el instalador publicado en
   la release del tag (`install.sh` para Linux/macOS e `install.ps1` para Windows).
   El motor expone el grupo `speech` (superficies 1, 5 y 6) que el plugin consume.
2. Los seis modelos de la selección de `setup`, descargados con
   `ai-voice-interconnector setup` (los instaladores lo encadenan):
   `qwen3-tts-0.6b` (CustomVoice), `qwen3-tts-0.6b-base` (Base), `opus-mt-es-en`,
   `opus-mt-en-es`, `parakeet-tdt-v3` y `dpdfnet8`. El daemon requiere los cinco
   primeros para arrancar; `dpdfnet8` es opcional para ese arranque y necesario
   para `--denoise`. `doctor` comprueba la selección completa. La voz Base es requerida por las voces
   clonadas, incluida `default`. La narración usa la voz activa de `/config`
   (`default` si no está fijada) y la pasa siempre explícita con `--voice` y
   `--warm-voice`.

El comando `/evolutivex-agents:install` del plugin guía ambos pasos.

## Degradación y no intrusión

Si el CLI no está en el `PATH`, el modelo no está en caché, o el daemon no responde, el plugin **degrada en silencio**: no reproduce audio, no bloquea ni retrasa el turno de Claude Code, y (solo en `SessionStart`) emite un aviso informativo. La ausencia del motor nunca es un error para el usuario de Claude Code.

El canal de **notificaciones de escritorio** (`dist/notification-hook.js`, `dist/notification-cli.js` y `dist/notification-register.js`) es completamente independiente del motor `ai-voice-interconnector` y de su daemon: se controla por separado con `notificationsEnabled` en `/config` (frente a `voiceEnabled` en `/config`) y funciona aunque el motor de voz no esté instalado o esté detenido.

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
con `narrate-ctl presynth --voice <voz>`. No se recomienda `cleanup --all` ni ningún
`doctor --repair` automático.

## Estabilidad del contrato

El plugin asume estables los flags y el esquema JSON de las diez superficies de arriba. El contrato del motor (`docs/CLI/CONTRACT.md §12` y `docs/CLI/commands/VOICE.md`, contrastados con v0.42.0) publica esas superficies: `speech say`, `speech synthesize`, `speech play`, `doctor --json`, `daemon status --json`, `daemon start`, `voice list`, `voice clone`, `voice remove` y `version --json`, con `--voice` y `--warm-voice`. `doctor` es integral: incluye instalación, receipt, PATH, residuos y modelos, también en canal `unmanaged`; no es una comprobación parcial de recursos. Por eso el plugin aplica su propio gate de recursos (`models_provisioned` y `onnx_runtime`) y solo avisa del resto. `degraded` o estado incierto impiden el arranque y `warm_failed` se informa sin reiniciar. La gestión de voces exige como mínimo el motor v0.42.0, que `narrate-ctl` comprueba con `version --json` antes de cada operación `voice *`.
