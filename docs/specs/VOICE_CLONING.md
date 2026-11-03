# Especificación de diseño: clonado de voz y voz activa

> **Estado**: propuesta, no implementada · **Versión base del plugin**: 0.1.0 · **Contrato del motor verificado**: AI Voice-InterConnector v0.42.0 · **Fecha**: 2026-11-03

Este documento fija el diseño y los criterios de aceptación para que el usuario narre la actividad de Claude Code con **su propia voz**, clonada con el motor AI Voice-InterConnector. Es la fuente de verdad funcional de la feature: la implementación, la documentación de usuario y los tests se derivan de él.

## Tabla de contenidos

- [1. Propósito](#1-propósito)
- [2. Alcance](#2-alcance)
- [3. Contexto actual](#3-contexto-actual)
- [4. Glosario](#4-glosario)
- [5. Requisitos](#5-requisitos)
- [6. Decisiones](#6-decisiones)
- [7. Diseño](#7-diseño)
- [8. Invariantes](#8-invariantes)
- [9. Errores y mensajes](#9-errores-y-mensajes)
- [10. Estrategia de pruebas](#10-estrategia-de-pruebas)
- [11. Criterios de aceptación](#11-criterios-de-aceptación)
- [12. Documentación afectada](#12-documentación-afectada)
- [13. Riesgos y trabajo futuro](#13-riesgos-y-trabajo-futuro)
- [14. Referencias](#14-referencias)

---

## 1. Propósito

Hoy el plugin narra siempre con la voz de fábrica `default`. Esta feature permite clonar una voz desde un archivo WAV o desde el micrófono, elegirla como voz activa en `/config` y oírla en toda la narración: los anuncios pre-sintetizados, el resumen de `Stop` y la narración a demanda.

El diseño respeta la arquitectura actual:

- El plugin sigue siendo un **cliente delgado**: el motor es el dueño del audio, del clonado y del almacén de voces.
- El plugin solo maneja el **nombre** de la voz activa; nunca audio, rutas de referencia ni secretos.
- Las preferencias siguen viviendo **solo en `/config`** (`userConfig`).
- La voz activa se aplica de forma **consistente** en todas las rutas que producen audio.

## 2. Alcance

### Dentro del alcance

- Clonar una voz desde un archivo WAV o desde el micrófono, con nombre propio y `--denoise` opcional.
- Listar las voces, distinguiendo las de fábrica.
- Elegir la voz activa en `/config` → `evolutivex-agents.voice`.
- Pre-sintetizar los seis anuncios estáticos con una voz concreta.
- Reproducir los anuncios, sintetizar el resumen de `Stop` y narrar a demanda con la voz activa.
- Arrancar el daemon precalentando la voz activa.
- Borrar voces de usuario con confirmación; las de fábrica quedan protegidas.
- Diagnosticar en `SessionStart` una voz activa inexistente o con nombre inválido.
- Guiar al usuario en la grabación o elección de la referencia, también desde la instalación guiada.
- Documentar el contrato ampliado con el motor y cubrir la feature con tests.

### Fuera del alcance

- Capturar o procesar audio en el código del plugin: la I/O de audio es del motor.
- Perfiles de voz por evento, varias voces activas o una voz por sesión o proyecto.
- Entrenar, editar o fusionar voces.
- Clonado remoto: el motor es local y la referencia no sale de la máquina.
- Copiar locuciones entre voces.

## 3. Contexto actual

### Plugin

- **Configuración**: `loadConfig()` (`src/lib/config.ts`) lee `CLAUDE_PLUGIN_OPTION_*`. Claude Code entrega esas variables a los hooks de comando, pero **no a la herramienta de shell**, desde donde la skill ejecuta `narrate-ctl`.
- **Narración por hooks**: `narrate-hook` encola el payload y lanza el worker desanclado; el worker (`src/voice/narrate-worker.ts`) reproduce con `speech play --label … --json` o sintetiza con `speech say --text … --daemon --json`. El worker carga la configuración de su propio entorno, heredado del hook que lo lanzó, y vive mientras la cola tenga trabajo más 5 s.
- **`SessionStart`** (`src/voice/health-check.ts`): `doctor --json` (≤20 s) y, con recursos sanos, `daemon status --json` (≤5 s); si el daemon está parado, `daemon start` desanclado y sin observar el resultado (`src/voice/daemon.ts`).
- **`narrate-ctl`** (`src/narrate-ctl.ts`): `status`, `say "<texto>"` y `presynth [--force]`. Ninguno pasa `--voice`.
- **Catálogo**: seis anuncios con etiqueta fija (`src/voice/message/static-announcements.ts`).
- **Invocación del CLI**: `runCli`/`spawnCli` (`src/voice/resolve-cli.ts`) es la única costura; en Windows cita los argumentos para los shims `.cmd`.
- **Versión del motor**: el plugin está verificado contra un único corte, `engine.aiVoiceInterConnector` de `package.json` (hoy `0.42.0`), y no comprueba la versión en tiempo de ejecución.

### Motor (v0.42.0)

- `voice list`, `voice clone` y `voice remove` existen; `--voice` está en `speech synthesize`, `speech say` y `speech play` (por defecto `default`), y `--warm-voice` en `daemon start` (por defecto `default`).
- Las locuciones se guardan por `(voz, etiqueta)` en `<data_dir>/speech/<voz>/<etiqueta>.wav`: cada voz necesita sus propias seis locuciones.
- El motor valida el nombre de la voz (`invalid_voice_name`), protege las voces de fábrica al borrar (`cannot_remove_default`) y exige confirmación al borrar una voz con locuciones si no hay terminal (`confirmation_required`).
- El motor **permite** clonar con `--force` sobre una voz de fábrica.
- `daemon start --warm-voice <n>` falla al instante con exit 3 `voice_not_found` si la voz no existe.
- `voice clone` puede tardar varios minutos. Con `--mic` sin `--duration` exige una terminal interactiva (push-to-talk).
- El residente TTS del daemon es de una sola voz: sintetizar con otra voz lo reemplaza y paga un arranque en frío.

## 4. Glosario

| Término                 | Definición                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Voz**                 | Entrada del almacén de voces del motor: de fábrica (`default`, `ryan`, `vivian`) o clonada por el usuario.                                         |
| **Voz activa**          | Valor del campo `voice` de `userConfig`, elegido por el usuario en `/config`. Si no está fijado, `default`.                                        |
| **Caché de voz activa** | Archivo `active-voice` del _state dir_ que escriben los hooks con la voz activa vigente, para que `narrate-ctl` la conozca. No es una preferencia. |
| **Referencia**          | Audio que el usuario entrega para clonar (WAV o micrófono). Se recomiendan ~10 s; máximo 30 s.                                                     |
| **Huella de timbre**    | `reference.qvoice`, lo único que el motor guarda de una voz clonada.                                                                               |
| **Etiqueta**            | Identificador fijo de un anuncio pre-sintetizado (`voice-stop`, …).                                                                                |
| **Locución**            | WAV pre-sintetizado que el motor guarda bajo `(voz, etiqueta)`.                                                                                    |
| **Pre-síntesis**        | Sintetizar una vez las seis etiquetas de una voz para que `speech play` sea instantáneo.                                                           |
| **`reason`**            | Causa fina del error en el JSON del motor; el exit code solo da la clase.                                                                          |

## 5. Requisitos

### 5.1 Requisitos funcionales

| ID        | Requisito                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RF-01** | Clonar una voz con nombre desde exactamente una fuente: un WAV o el micrófono (`--duration` de 1 a 30 s, o push-to-talk en una terminal interactiva). `--force` reemplaza una voz de usuario existente. |
| **RF-02** | Ofrecer `--denoise` opcional para ambas fuentes, sin activarlo por defecto y sin degradar a audio sin limpiar si falla.                                                                                 |
| **RF-03** | Impedir clonar sobre una voz de fábrica.                                                                                                                                                                |
| **RF-04** | Listar las voces y marcar las de fábrica.                                                                                                                                                               |
| **RF-05** | La voz activa se elige en `/config` → `evolutivex-agents.voice`; el plugin no escribe la configuración.                                                                                                 |
| **RF-06** | Al terminar de clonar, pre-sintetizar las seis etiquetas con la voz nueva y forzando la sobrescritura, e indicar el valor que hay que fijar en `/config` solo si las seis terminaron bien.              |
| **RF-07** | `presynth` pre-sintetiza con la voz que se le indique, o con la voz activa si no se indica; `--force` re-sintetiza.                                                                                     |
| **RF-08** | Los anuncios estáticos se reproducen y el resumen de `Stop` se sintetiza con la voz activa vigente **en el momento del evento**.                                                                        |
| **RF-09** | La narración a demanda (`say`) usa la voz que se le indique, o la voz activa si no se indica.                                                                                                           |
| **RF-10** | `SessionStart` arranca el daemon precalentando la voz activa cuando está parado y la voz existe.                                                                                                        |
| **RF-11** | Borrar una voz de usuario exige confirmación explícita, protege las de fábrica, informa las locuciones borradas y advierte si la voz es la activa.                                                      |
| **RF-12** | `SessionStart` avisa si la voz activa no existe o si su nombre es inválido.                                                                                                                             |
| **RF-13** | Sin fallback silencioso: si la voz activa no existe o es inválida, la narración falla, se registra en `worker.log` y el turno sigue sin audio.                                                          |
| **RF-14** | El plugin no copia, mueve ni borra la referencia del usuario, y no manipula audio.                                                                                                                      |
| **RF-15** | El plugin no guarda audio, rutas de referencia ni secretos; solo el nombre de la voz.                                                                                                                   |
| **RF-16** | La feature es opt-in: sin `voice` fijado, todo funciona como hoy con `default`.                                                                                                                         |
| **RF-17** | Si el motor instalado es anterior a la versión mínima de la feature, la gestión de voces informa que no está disponible y la narración sigue con `default`.                                             |
| **RF-18** | El usuario dispone del comando `/evolutivex-agents:voice` y de la skill `narrate` para clonar, listar, borrar y activar voces, y la instalación guiada ofrece clonar la voz de forma opcional.          |
| **RF-19** | La documentación explica los requisitos de la referencia, la privacidad y el costo de cambiar de voz.                                                                                                   |

### 5.2 Requisitos no funcionales

| ID         | Requisito                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RNF-01** | Sin dependencias nuevas de runtime: solo Node.js y la CLI del motor.                                                                                         |
| **RNF-02** | El launcher de hooks sigue saliendo en menos de 100 ms y no invoca al motor.                                                                                 |
| **RNF-03** | La lógica de nombres, el parseo de `voice list`, la construcción de argumentos y la interpretación de errores son puras y se prueban sin motor.              |
| **RNF-04** | Toda operación de voz pasa por `narrate-ctl`; el comando y la skill solo explican, confirman y orquestan.                                                    |
| **RNF-05** | `SessionStart` respeta su timeout de 30 s con un deadline global que acota cada consulta al motor.                                                           |
| **RNF-06** | Los errores se interpretan por operación, exit y `reason`, con un mensaje genérico para razones desconocidas; nunca se muestra un stack trace.               |
| **RNF-07** | Mismo comportamiento en Windows, Linux y macOS, incluidas rutas con espacios y shims `.cmd`.                                                                 |
| **RNF-08** | Las operaciones manuales de voz (`voice clone`, `voice remove`, `presynth`) se excluyen entre sí por _state dir_, sin bloquear nunca la narración por hooks. |
| **RNF-09** | Las operaciones largas (clonado y pre-síntesis) se ejecutan desde Claude Code con un timeout de herramienta suficiente y con su progreso visible.            |
| **RNF-10** | `lint`, `format:check`, `typecheck`, `test` y `check-dist` pasan en CI en los tres sistemas.                                                                 |

## 6. Decisiones

| ID       | Decisión                                                                                                                                                                                                                           | Motivo                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-01** | Una sola voz activa global, en el campo `voice` de `userConfig`.                                                                                                                                                                   | `/config` es la única fuente de preferencias del plugin.                                                                                       |
| **D-02** | El launcher anota la voz activa en cada ítem que encola y el worker narra con la voz del ítem.                                                                                                                                     | El worker puede vivir más que el entorno que heredó: así un cambio en `/config` se aplica desde el siguiente evento, sin ventana de voz vieja. |
| **D-03** | Los hooks (launcher y `SessionStart`) escriben la caché `active-voice` en el _state dir_; `narrate-ctl` la lee cuando no recibe `--voice`.                                                                                         | La herramienta de shell no recibe `/config`; sin la caché, `say` y `presynth` sonarían con `default`. La caché se reescribe en cada evento.    |
| **D-04** | `narrate-ctl` gana la familia `voice` (`list`, `clone`, `remove`) y `--voice` en `presynth` y `say`; el comando `/evolutivex-agents:voice` y la skill son la capa de explicación y confirmación.                                   | Una sola implementación determinista y testeable.                                                                                              |
| **D-05** | `voice clone` usa siempre el daemon (`--daemon`).                                                                                                                                                                                  | El daemon precalienta la voz nueva y la pre-síntesis siguiente la aprovecha; un único camino que probar.                                       |
| **D-06** | `voice clone` termina con `presynth --voice <nombre> --force`; solo con seis éxitos indica fijar `evolutivex-agents.voice` en `/config`.                                                                                           | La voz nueva tiene sus locuciones antes de activarla; `--force` evita locuciones viejas tras un re-clonado.                                    |
| **D-07** | La voz se pasa siempre explícita (`--voice`, `--warm-voice`), también `default`.                                                                                                                                                   | No depender del valor por defecto implícito del motor.                                                                                         |
| **D-08** | El plugin delega en el motor la validación de nombres, la protección de fábrica al borrar y la confirmación de borrado; solo añade el bloqueo de clonado sobre fábrica, la exigencia de `--yes` y la guía de `--mic` sin terminal. | Evitar reglas duplicadas que puedan divergir del motor; el motor no protege la fábrica al clonar.                                              |
| **D-09** | Sin fallback automático a `default` en runtime; `SessionStart` avisa.                                                                                                                                                              | Una voz distinta de la elegida sorprende y oculta la causa.                                                                                    |
| **D-10** | La exclusión entre operaciones manuales es un directorio `voice-operation.lock` creado con `mkdir` exclusivo y el PID del dueño; solo se retira si ese PID ya no existe.                                                           | Suficiente para operaciones manuales y poco frecuentes de un único usuario; el motor ya escribe de forma atómica y serializa las síntesis.     |
| **D-11** | La versión mínima se comprueba con `version --json` solo en las operaciones `voice *` de `narrate-ctl`, nunca en los hooks.                                                                                                        | No añade latencia a los hooks; la narración existente no depende de la feature.                                                                |
| **D-12** | Desde Claude Code, `--mic` se usa con `--duration` (10 s sugeridos); el push-to-talk se ofrece solo como comando para una terminal del usuario.                                                                                    | La herramienta de shell no es una terminal interactiva.                                                                                        |
| **D-13** | `--denoise` es optativo y sin fallback; su preservación de identidad vocal no está validada con una prueba humana.                                                                                                                 | Contrato del motor.                                                                                                                            |
| **D-14** | El daemon no se reinicia al cambiar de voz.                                                                                                                                                                                        | El residente se reemplaza bajo demanda; la pre-síntesis lo deja caliente.                                                                      |

## 7. Diseño

### 7.1 Configuración y caché de voz activa

`userConfig` (`.claude-plugin/plugin.json`) incorpora un campo de texto libre:

```json
"voice": {
  "type": "string",
  "title": "Voz de la narración",
  "description": "Nombre de la voz del motor con la que se narra (default, ryan, vivian o una voz clonada). Antes de activar una voz, pre-sintetiza sus anuncios.",
  "default": "default"
}
```

Reglas de `loadConfig()`:

- Lee `CLAUDE_PLUGIN_OPTION_VOICE`, recorta y pasa a minúsculas (el motor también normaliza a minúsculas).
- Ausente o vacío → `default`.
- Un nombre que no pasa `isPlausibleVoiceName` **no** se sustituye por `default`: se conserva, y `SessionStart` avisa (RF-12, RF-13).
- No consulta al motor.

Caché de voz activa:

- Archivo `active-voice` en `stateDir()`, con el nombre en una línea.
- La escriben `narrate-hook` (en cada evento, también con la voz desactivada) y `health-check`, solo si el contenido cambió; un fallo de escritura se ignora.
- `narrate-ctl` la lee cuando no recibe `--voice`; si falta o no se puede leer, usa `default` e informa de dónde salió la voz.
- No es una preferencia: el usuario no la edita y se reescribe desde `/config` en el siguiente evento.

### 7.2 Módulo `src/voice/voice.ts`

Módulo puro, sin I/O:

```ts
export const DEFAULT_VOICE = "default";
export const FACTORY_VOICES = ["default", "ryan", "vivian"] as const;
export const MIN_ENGINE_VERSION = "0.42.0";

export function normalizeVoiceName(raw: string): string;
export function isPlausibleVoiceName(name: string): boolean;
export function isFactoryVoice(name: string): boolean;
export function parseVoiceList(stdout: string): string[] | undefined;
export function meetsMinVersion(version: string): boolean;
```

- `isPlausibleVoiceName` solo decide avisos y mensajes (letras y números ASCII, punto, guion y guion bajo, hasta 64 caracteres, sin `..`); el motor sigue siendo la autoridad sobre el nombre.
- `parseVoiceList` acepta `{"voices": string[]}` y tolera claves adicionales; cualquier otra forma devuelve `undefined`.

### 7.3 Superficie de `narrate-ctl`

```text
node dist/narrate-ctl.js status
node dist/narrate-ctl.js say [--voice <nombre>] "<texto>"
node dist/narrate-ctl.js presynth [--voice <nombre>] [--force]
node dist/narrate-ctl.js voice list
node dist/narrate-ctl.js voice clone <nombre> <ruta.wav> [--force] [--denoise]
node dist/narrate-ctl.js voice clone <nombre> --mic [--duration <segs>] [--force] [--denoise]
node dist/narrate-ctl.js voice remove <nombre> --yes
```

- **`status`**: añade la línea `voz activa: <nombre> (según el último evento)` leída de la caché, o `default (sin datos de /config todavía)`.
- **`say`**: `speech say --text … --voice <voz> --daemon`.
- **`presynth`**: para cada etiqueta, `speech synthesize --text … --label … --voice <voz> [--force] --daemon --json`. Sin `--force`, solo exit 6 con `reason: label_exists` cuenta como éxito idempotente. Informa cada etiqueta y termina con código distinto de cero si alguna falla.
- **`voice list`**: `voice list --json`; imprime las voces y marca las de fábrica y la activa según la caché.
- **`voice clone`**: ver §7.4.
- **`voice remove`**: ver §7.7.
- Las operaciones `voice *` comprueban antes la versión mínima (§7.9); `voice clone`, `voice remove` y `presynth` toman el bloqueo de operaciones manuales (§7.8).
- Un hijo que no se inició, terminó por señal o agotó su timeout es un fallo; nunca se interpreta `status: null` como éxito.
- El exit de `narrate-ctl` es el del motor, salvo los errores propios del plugin descritos en §9.

### 7.4 Flujo de clonado

```text
Usuario ──► /evolutivex-agents:voice clone <nombre> [<ruta.wav> | --mic [--duration <seg>]]
               │ explica la referencia, la privacidad y la duración; pide confirmación
               ▼
narrate-ctl voice clone
  1. versión mínima y bloqueo de operaciones manuales
  2. rechaza nombres de fábrica (exit 2, sin invocar al motor)
  3. con --mic sin --duration y sin terminal interactiva: exit 2 con la guía de D-12
  4. voice clone --name … (--speech-reference … | --mic [--duration …]) [--force] [--denoise] --daemon --json
     (stdin y stderr heredados para el push-to-talk y el progreso; stdout capturado para el JSON)
  5. presynth --voice <nombre> --force (reutiliza el bloqueo ya tomado)
  6. seis éxitos → «Fija /config → evolutivex-agents.voice = <nombre>»
     algún fallo → informa la etiqueta, que la huella ya cambió y que hay que reintentar presynth --voice <nombre> --force
```

- El plugin no valida la existencia del WAV ni el nombre: el motor responde `audio_not_found`, `invalid_audio` o `invalid_voice_name`.
- `precomputed: true` significa «precalentamiento iniciado», no «listo».
- El plugin no activa la voz: la activa el usuario en `/config`.

### 7.5 Activación

El usuario fija `evolutivex-agents.voice` en `/config`. Desde el siguiente evento:

- El launcher anota la voz en el ítem encolado y actualiza la caché.
- El worker reproduce y sintetiza con la voz del ítem.

Si la voz no tiene locuciones, los anuncios fallan con `speech_not_found` (registrado en `worker.log` con el remedio `presynth --voice <nombre>`) hasta pre-sintetizarla. Para volver a una voz existente basta `presynth --voice <nombre>`, que es idempotente.

### 7.6 Rutas de runtime

`buildMessage()` no cambia: decide **qué** se narra. La voz es transporte:

| Componente                                    | Cambio                                                              |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `src/voice/narrate-hook.ts`                   | Anota `voice` en el ítem encolado y escribe la caché.               |
| `src/voice/queue.ts`                          | El ítem guarda el payload y la voz.                                 |
| `src/voice/narrate-worker.ts` → `runPlay`     | `speech play --label <label> --voice <voz del ítem> --json`.        |
| `src/voice/narrate-worker.ts` → `runSay`      | `speech say --text <texto> --voice <voz del ítem> --daemon --json`. |
| `src/voice/narrate-worker.ts` → pistas        | `speech_not_found` y `voice_not_found` nombran la voz y su remedio. |
| `src/voice/daemon.ts` → `startDaemonDetached` | Recibe la voz y pasa `--warm-voice <voz>`.                          |
| `src/narrate-ctl.ts`                          | `say`, `presynth`, `status` y la familia `voice` (§7.3).            |

### 7.7 Borrado

1. `narrate-ctl` exige `--yes`; sin él, exit 2 sin invocar al motor.
2. Versión mínima y bloqueo de operaciones manuales.
3. `voice remove --name <nombre> --yes --json`.
4. El motor protege las voces de fábrica (`cannot_remove_default`) y responde `voice_not_found` si la voz no existe.
5. Se informa `removed_speech` y, si la caché indica que es la voz activa, se advierte que la narración fallará hasta elegir otra en `/config`.

El comando `/evolutivex-agents:voice` muestra antes qué se borrará (la voz y sus locuciones) y pide confirmación conversacional.

### 7.8 Exclusión entre operaciones manuales

- Directorio `voice-operation.lock` en `stateDir()`, creado con `mkdir` exclusivo; dentro, el archivo `owner` con el PID.
- Si ya existe: con un PID vivo (`isAlive`, que cuenta `EPERM` como vivo) o un `owner` ausente o ilegible, la operación termina con exit 6 y el mensaje de §9, sin modificar nada; con un PID que ya no existe, se retira y se reintenta una vez.
- Se libera al terminar, también ante error.
- `voice clone` reutiliza el bloqueo para su pre-síntesis interna.
- El worker y los hooks nunca lo toman.
- Límites aceptados: un PID reutilizado bloquea de más (lado seguro) y se resuelve borrando el directorio a mano; si el dueño muere mientras el daemon sigue clonando, la huella puede quedar guardada sin pre-síntesis, y se repara con `presynth --voice <nombre> --force`.

### 7.9 Versión mínima

- Las operaciones `voice *` de `narrate-ctl` ejecutan `version --json` (timeout de 5 s) y comparan `version` con `MIN_ENGINE_VERSION`.
- Una versión inferior o ilegible → exit 1 con «La gestión de voces requiere AI Voice-InterConnector 0.42.0 o posterior»; la narración existente no cambia.

### 7.10 `SessionStart`

`health-check` amplía su flujo sin bloquear la sesión y con un deadline global de 28 s:

1. Escribe la caché de voz activa.
2. Si el nombre de la voz no es plausible: `systemMessage` de nombre inválido y no arranca el daemon.
3. `doctor --json` (≤20 s) y, con recursos sanos, `daemon status --json` (≤5 s), como hoy.
4. Si la voz no es `default` y el daemon está `running` o `stopped` limpio: `voice list --json` (≤2 s y nunca más que el tiempo restante). Si la voz no está, `systemMessage` y no arranca el daemon. Un listado fallido, un JSON inválido o un timeout se informan como diagnóstico incierto, sin afirmar que la voz falta y sin arrancar.
5. Daemon parado y voz existente: `daemon start --warm-voice <voz>` desanclado. Corriendo: no se reinicia.
6. `degraded`, estado incierto y `warm_failed` se tratan como hoy.

### 7.11 Contrato del motor consumido

| Superficie                                                                                                          | Uso                                    |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `voice clone --name <n> (--speech-reference <wav> \| --mic [--duration <s>]) [--force] [--denoise] --daemon --json` | Clonado.                               |
| `voice list --json`                                                                                                 | Listado y validación de la voz activa. |
| `voice remove --name <n> --yes --json`                                                                              | Borrado.                               |
| `version --json`                                                                                                    | Versión mínima de la feature.          |
| `--voice <n>` en `speech synthesize`, `speech say` y `speech play`                                                  | Voz explícita en todas las rutas.      |
| `--warm-voice <n>` en `daemon start`                                                                                | Precalentar la voz activa.             |

| Operación           | Salida consumida                  | Códigos relevantes                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice clone`       | `{name, speech, precomputed}`     | `0`; `1` `voice_clone_failed`/`io_error`/`denoise_unsupported`/`denoise_failed`; `2` `invalid_voice_name`/`invalid_audio`/`audio_too_long`/`empty_audio`/`usage_error`; `3` `audio_not_found`/`no_input_device`/`audio_backend_unavailable`; `4` `model_missing`; `5` `daemon_unreachable`; `6` `voice_exists`/`denoise_busy`; `10` `transcription_failed`; `17` `lifecycle_locked` |
| `voice list`        | `{voices: string[]}`              | `0`; `1`; `17` `lifecycle_locked`                                                                                                                                                                                                                                                                                                                                                   |
| `voice remove`      | `{status, voice, removed_speech}` | `0`; `1` `io_error`; `2` `invalid_voice_name`/`cannot_remove_default`/`confirmation_required`; `3` `voice_not_found`; `17` `lifecycle_locked`                                                                                                                                                                                                                                       |
| `speech synthesize` | `{status, audio_path, voice}`     | `0`; `3` `voice_not_found`; `4`; `5`; `6` `label_exists`                                                                                                                                                                                                                                                                                                                            |
| `speech say`        | `{status, voice}`                 | `0`; `1` `playback_failed`/`synthesis_failed`; `3` `voice_not_found`/`no_output_device`/`audio_backend_unavailable`; `4`; `5`                                                                                                                                                                                                                                                       |
| `speech play`       | `{status, label, voice}`          | `0`; `1` `playback_failed`; `2`; `3` `speech_not_found`/`voice_not_found`/`no_output_device`/`audio_backend_unavailable`                                                                                                                                                                                                                                                            |
| `daemon start`      | no se observa (desanclado)        | `3` `voice_not_found` al instante si la voz no existe; por eso se valida antes (§7.10)                                                                                                                                                                                                                                                                                              |

Los envelopes llevan `schema_version` (hoy `"6"`), que el plugin no lee; las claves adicionales se toleran y un `reason` desconocido se trata como ausente. `--json` es global; `--daemon` solo lo aceptan `speech synthesize`, `speech say` y `voice clone`.

### 7.12 Experiencia de usuario

**Comando `commands/voice.md`**:

```text
/evolutivex-agents:voice clone <nombre> [<ruta.wav> | --mic [--duration <segs>]]
/evolutivex-agents:voice list
/evolutivex-agents:voice remove <nombre>
```

Explica en español:

- qué es una referencia y cuánto dura (~10 s, máximo 30 s), y que puede ser un WAV o el micrófono;
- que el motor guarda solo el timbre y que nada sale de la máquina;
- que la voz no se activa sola: se elige en `/config`;
- que una voz necesita sus anuncios pre-sintetizados;
- que borrar una voz borra sus locuciones.

Ejecuta `narrate-ctl` con la herramienta de shell con un timeout de 10 minutos para `voice clone` y `presynth`, y avisa de que el clonado puede tardar varios minutos. Para el micrófono propone `--duration 10`; si el usuario prefiere push-to-talk, le da el comando completo, con la ruta absoluta, para ejecutarlo en su terminal.

**Skill `skills/narrate/SKILL.md`**: reconoce intenciones como «clona mi voz», «qué voces tengo», «usa mi voz», «vuelve a la voz predeterminada» o «borra la voz X» y las resuelve con el mismo flujo del comando. Para activar o volver a una voz indica la opción de `/config` y, si hace falta, ejecuta antes `presynth --voice <nombre>`.

**Instalación guiada `commands/install.md`**: tras la pre-síntesis de `default`, pregunta si el usuario quiere clonar su voz. Si acepta, sigue el flujo del comando e indica el valor de `/config`; si no, `default` queda lista.

## 8. Invariantes

1. **Una voz activa global**: los hooks usan la de `/config` vigente en cada evento; `narrate-ctl`, la de `--voice` o la de la caché.
2. **Pre-síntesis antes de indicar la activación**: `voice clone` solo indica el valor de `/config` tras seis éxitos; si el usuario activa una voz sin locuciones, los anuncios fallan con un remedio registrado.
3. **Sin copia de locuciones entre voces**: cada voz tiene las suyas.
4. **Fábrica intocable desde el plugin**: no se clona encima ni se borra.
5. **Sin fallback silencioso**: una voz inexistente o inválida se avisa en `SessionStart` y se registra en `worker.log`.
6. **La referencia es del usuario**: el plugin no la copia, mueve ni borra.
7. **Sin secretos ni audio en la configuración**: `userConfig` solo guarda nombres y preferencias.
8. **Re-clonar no actualiza locuciones por sí solo**: hace falta la pre-síntesis forzada, que `voice clone` ejecuta.
9. **El daemon no se reinicia por cambiar de voz**.
10. **La voz no altera el contenido**: `buildMessage()` no recibe ni devuelve la voz.
11. **Un fallo de voz no bloquea el turno**.
12. **La narración por hooks nunca espera al bloqueo de operaciones manuales**.

## 9. Errores y mensajes

`narrate-ctl` interpreta cada error por operación, exit y `reason`; una razón desconocida conserva el exit con un mensaje genérico.

| Condición                                      | Origen                                                     | Exit | Mensaje orientativo                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| CLI no encontrado                              | Plugin                                                     | 1    | «AI Voice-InterConnector no está en el PATH.»                                                            |
| Motor anterior a la versión mínima             | Plugin                                                     | 1    | «La gestión de voces requiere AI Voice-InterConnector 0.42.0 o posterior.»                               |
| Otra operación de voz en curso                 | Plugin                                                     | 6    | «Hay otra operación de voz en curso; si no es así, borra `<state dir>/voice-operation.lock`.»            |
| Clonar sobre una voz de fábrica                | Plugin                                                     | 2    | «`default`, `ryan` y `vivian` son voces de fábrica; elige otro nombre.»                                  |
| `--mic` sin `--duration` y sin terminal        | Plugin                                                     | 2    | «Usa `--duration <segs>` (se sugieren 10) o ejecuta el comando en tu terminal para el push-to-talk.»     |
| `voice remove` sin `--yes`                     | Plugin                                                     | 2    | «Confirma el borrado con `--yes`.»                                                                       |
| Nombre inválido                                | Motor `2 invalid_voice_name`                               | 2    | «Usa letras, números, punto, guion o guion bajo.»                                                        |
| Referencia inexistente                         | Motor `3 audio_not_found`                                  | 3    | «La ruta de referencia no existe.»                                                                       |
| WAV inválido, vacío o de más de 30 s           | Motor `2 invalid_audio` / `empty_audio` / `audio_too_long` | 2    | «Usa un WAV válido de hasta 30 s; se recomiendan ~10 s.»                                                 |
| Sin micrófono o sin backend de audio           | Motor `3 no_input_device` / `audio_backend_unavailable`    | 3    | «No hay micrófono predeterminado o falta el backend de audio: revisa `ai-voice-interconnector devices`.» |
| Otro fallo de captura                          | Motor `10 transcription_failed`                            | 10   | «No se pudo capturar audio: revisa los permisos del micrófono o usa un WAV.»                             |
| Voz ya existente sin `--force`                 | Motor `6 voice_exists`                                     | 6    | «Elige otro nombre o usa `--force` para reemplazarla.»                                                   |
| Limpieza ocupada                               | Motor `6 denoise_busy`                                     | 6    | «Reintenta al terminar la limpieza en curso.»                                                            |
| Limpieza no disponible o fallida               | Motor `1 denoise_unsupported` / `denoise_failed`           | 1    | «Comprueba la instalación y el modelo de limpieza.»                                                      |
| Modelo ausente                                 | Motor `4 model_missing`                                    | 4    | «Ejecuta `ai-voice-interconnector setup`.»                                                               |
| Daemon caído                                   | Motor `5 daemon_unreachable`                               | 5    | «Levanta el daemon con `ai-voice-interconnector daemon start`.»                                          |
| Fallo del clonado                              | Motor `1 voice_clone_failed`                               | 1    | «El clonado falló; el mensaje del motor indica su log.»                                                  |
| Borrar una voz de fábrica                      | Motor `2 cannot_remove_default`                            | 2    | «Las voces de fábrica no se pueden borrar.»                                                              |
| Voz inexistente                                | Motor `3 voice_not_found`                                  | 3    | «Consulta `voice list` y elige una voz existente.»                                                       |
| Ciclo de vida ocupado                          | Motor `17 lifecycle_locked`                                | 17   | «Espera a que termine la instalación o limpieza del motor.»                                              |
| Etiqueta existente sin `--force`               | Motor `6 label_exists`                                     | 0    | «Ya pre-sintetizado.»                                                                                    |
| Proceso no iniciado, señal o timeout           | Plugin                                                     | 1    | «No se pudo completar la operación.»                                                                     |
| JSON inválido del motor                        | Plugin                                                     | 1    | «El motor devolvió una respuesta inesperada.»                                                            |
| Voz activa sin locuciones (hooks)              | Motor `3 speech_not_found` en `play`                       | —    | `worker.log`: «locución no pre-sintetizada para la voz <v>; ejecuta narrate-ctl presynth --voice <v>».   |
| Voz activa inexistente (hooks)                 | Motor `3 voice_not_found`                                  | —    | `worker.log` y `systemMessage` en `SessionStart`: «La voz <v> no existe; elige otra en `/config`.»       |
| Nombre de voz activa inválido (`SessionStart`) | Plugin                                                     | —    | `systemMessage`: «El nombre de voz «<v>» de `/config` no es válido.»                                     |

## 10. Estrategia de pruebas

### 10.1 Unitarias (`npm test`)

- `tests/voice.spec.ts`: normalización, nombres plausibles, voces de fábrica, parseo válido e inválido de `voice list` y comparación de versiones.
- `tests/config.spec.ts`: `voice` por defecto, lectura y normalización de `CLAUDE_PLUGIN_OPTION_VOICE` y nombre inválido conservado.
- `tests/narrate-hook.spec.ts`: el ítem encolado lleva la voz; la caché se escribe, también con la voz desactivada.
- `tests/narrate-worker.spec.ts`: `play` y `say` usan la voz del ítem; las pistas nombran la voz.
- `tests/daemon.spec.ts`: `--warm-voice` siempre presente.
- `tests/health-check.spec.ts`: arranque con la voz activa; voz ausente, nombre inválido y listado incierto sin arranque; deadline global.

### 10.2 Integración con CLI falso (`tests/narrate-ctl.spec.ts`)

Con el patrón de `tests/helpers.ts`, un CLI falso que registra `argv`, programa exit y JSON por comando y puede fallar en una etiqueta concreta:

1. Clonar desde WAV y desde micrófono (con `--duration`); `--force` y `--denoise` se transmiten.
2. Clonar termina con seis `speech synthesize --voice <n> --force` y solo entonces indica `/config`.
3. Fallo de una pre-síntesis al clonar: exit ≠ 0, etiqueta informada y sin indicación de `/config`.
4. Nombre de fábrica al clonar, `--mic` sin `--duration` sin terminal y `remove` sin `--yes`: exit 2 sin invocar al motor.
5. `presynth` y `say` usan `--voice`, o la caché, o `default`.
6. `voice list` marca fábrica y activa; `voice remove` informa `removed_speech` y advierte de la voz activa.
7. Versión inferior o ilegible: exit 1 sin invocar `voice`.
8. Bloqueo: dueño vivo, dueño muerto, `owner` ilegible, liberación ante error y reutilización en la pre-síntesis interna.
9. Mapeo de cada `reason` de §9, razón desconocida, proceso no iniciado, señal y timeout.
10. Rutas con espacios y shim `.cmd` en Windows.

### 10.3 Prueba manual de punta a punta

Con el motor real y una sesión de Claude Code: clonar una voz por micrófono con `--duration` y otra por WAV, activarla en `/config`, oír los anuncios y un `Stop` con esa voz, narrar con `say` sin `--voice`, volver a `default` y borrar la voz. Se registran la plataforma y las rutas no ejecutadas. No corre en CI porque requiere modelos y audio.

### 10.4 Gates

`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run check-dist`, `claude plugin validate --strict .` y CI en Linux, Windows y macOS.

## 11. Criterios de aceptación

| ID        | Dado                                                            | Cuando                                             | Entonces                                                                                                                     |
| --------- | --------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **AC-01** | Sin `voice` en `/config`                                        | Se dispara cualquier hook                          | Todas las rutas usan `--voice default` y el comportamiento es el de hoy.                                                     |
| **AC-02** | Daemon, WAV válido y nombre libre                               | `voice clone nombre ref.wav`                       | El motor recibe `voice clone --name nombre --speech-reference ref.wav --daemon --json`; luego seis pre-síntesis; exit 0.     |
| **AC-03** | Daemon, micrófono y nombre libre                                | `voice clone nombre --mic --duration 10`           | El motor recibe `--mic --duration 10 --daemon --json`; luego seis pre-síntesis; exit 0.                                      |
| **AC-04** | Una voz existente                                               | Se clona sin `--force`                             | Exit 6 y el mensaje ofrece `--force`; nada cambia.                                                                           |
| **AC-05** | Una voz existente y `--force`                                   | Se clona                                           | El motor recibe `--force` y las seis pre-síntesis llevan `--force`.                                                          |
| **AC-06** | Un nombre de fábrica                                            | Se intenta clonar                                  | Exit 2 sin invocar al motor.                                                                                                 |
| **AC-07** | Un nombre de fábrica                                            | Se intenta borrar                                  | El motor responde `cannot_remove_default`; exit 2 y nada se borra.                                                           |
| **AC-08** | Clonado correcto                                                | Termina `voice clone`                              | Solo tras seis éxitos se indica fijar `evolutivex-agents.voice` en `/config`.                                                |
| **AC-09** | Falla una pre-síntesis del clonado                              | Termina el comando                                 | Exit ≠ 0, se informa la etiqueta y que hay que reintentar `presynth --voice <n> --force`; no se indica `/config`.            |
| **AC-10** | `voice = mi_voz` en `/config`                                   | El worker narra un evento estático y un `Stop`     | `speech play … --voice mi_voz` y `speech say … --voice mi_voz --daemon`.                                                     |
| **AC-11** | Un worker drenando con `mi_voz` y el usuario cambia a `default` | Llega el siguiente evento                          | Ese evento se narra con `default`.                                                                                           |
| **AC-12** | La caché indica `mi_voz`                                        | `say "hola"` o `presynth` sin `--voice`            | Usan `--voice mi_voz`; sin caché, `default`, y lo informan.                                                                  |
| **AC-13** | Voz activa existente y daemon parado                            | `SessionStart` con entorno sano                    | `daemon start --warm-voice <voz>`.                                                                                           |
| **AC-14** | Voz activa inexistente                                          | `SessionStart`                                     | `systemMessage`; el daemon no arranca; la configuración no cambia.                                                           |
| **AC-15** | Nombre de voz inválido en `/config`                             | `SessionStart` y un evento narrado                 | `systemMessage` de nombre inválido; la narración falla y se registra, sin caer a `default`.                                  |
| **AC-16** | `voice list` falla o devuelve JSON inválido                     | `SessionStart` con voz no predeterminada           | Diagnóstico incierto, sin afirmar que la voz falta y sin arrancar el daemon.                                                 |
| **AC-17** | Daemon corriendo con otra voz                                   | `SessionStart`                                     | No se reinicia.                                                                                                              |
| **AC-18** | Una voz de usuario                                              | `voice remove nombre --yes`                        | `voice remove --name nombre --yes --json`; se informan las locuciones borradas; si es la activa según la caché, se advierte. |
| **AC-19** | `voice remove` sin `--yes`                                      | Se ejecuta                                         | Exit 2 sin invocar al motor.                                                                                                 |
| **AC-20** | `--mic` sin `--duration` y sin terminal interactiva             | `voice clone`                                      | Exit 2 con la guía de D-12; no se inicia la captura.                                                                         |
| **AC-21** | `--denoise`                                                     | Se clona                                           | Se transmite; ausencia de modelo, saturación o fallo se informan sin clonar audio sin limpiar.                               |
| **AC-22** | Motor anterior a 0.42.0 o versión ilegible                      | Cualquier `voice *`                                | Exit 1 con el mensaje de versión; la narración sigue con `default`.                                                          |
| **AC-23** | Otra operación manual con el bloqueo y dueño vivo               | `voice clone`, `voice remove` o `presynth`         | Exit 6 sin modificar nada.                                                                                                   |
| **AC-24** | Bloqueo con dueño muerto                                        | Se inicia una operación manual                     | Se retira el bloqueo y la operación sigue.                                                                                   |
| **AC-25** | Una operación manual en curso                                   | Se dispara un hook                                 | El hook y el worker narran sin esperar al bloqueo.                                                                           |
| **AC-26** | Un hook se dispara                                              | Se mide el launcher                                | Menos de 100 ms y ninguna invocación al motor.                                                                               |
| **AC-27** | Uso normal                                                      | Se inspeccionan `userConfig` y el _state dir_      | No hay audio, rutas de referencia ni secretos; solo nombres y preferencias.                                                  |
| **AC-28** | El usuario rechaza clonar en la instalación                     | Termina la instalación                             | `default` queda pre-sintetizada y funcional.                                                                                 |
| **AC-29** | Windows, Linux y macOS                                          | Se ejecutan los tests                              | Pasan los mismos casos, con rutas con espacios y shims `.cmd`.                                                               |
| **AC-30** | La implementación termina                                       | Se ejecutan los gates y se revisa la documentación | Gates en verde y los documentos de §12 actualizados.                                                                         |

## 12. Documentación afectada

| Documento                     | Cambio                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `docs/specs/VOICE_CLONING.md` | Pasa a «implementada» con la versión del plugin.                                      |
| `docs/INTEGRATION.md`         | Superficies `voice *`, `version --json`, `--voice` y `--warm-voice`, con sus códigos. |
| `README.md`                   | Campo `voice` en la tabla de `/config`, comando de voz y privacidad de la referencia. |
| `SECURITY.md`                 | La referencia es local; el _state dir_ suma `active-voice` y `voice-operation.lock`.  |
| `CHANGELOG.md`                | Entrada de la feature.                                                                |
| `commands/install.md`         | Paso opcional de clonado.                                                             |
| `commands/voice.md`           | Nuevo comando.                                                                        |
| `skills/narrate/SKILL.md`     | Intenciones de voz, `--voice` en `say` y `presynth` y voz activa en `status`.         |
| `docs/RELEASING.md`           | El smoke test incluye clonar, activar, narrar y borrar una voz.                       |
| `docs/ROADMAP.md`             | Retirar la idea de clonado; dejar los perfiles por evento como futuro.                |

## 13. Riesgos y trabajo futuro

### Riesgos

- **Costo de cambiar de voz**: seis síntesis por voz. Es manual y poco frecuente.
- **Arranque en frío al cambiar de voz**: la primera síntesis con otra voz tarda más; la pre-síntesis lo mitiga.
- **Voz activa sin locuciones**: el usuario puede activar una voz sin pre-sintetizarla; los anuncios fallan con un remedio registrado.
- **Caché desfasada**: antes del primer evento tras un cambio en `/config`, `narrate-ctl` puede usar la voz anterior; `status` muestra qué voz conoce.
- **Clonado largo**: puede acercarse al timeout de la herramienta de shell; el comando avisa y fija 10 minutos.
- **Permisos de micrófono**: no verificados para procesos lanzados desde Claude Code en cada sistema; la prueba de punta a punta los cubre y el WAV es la alternativa.
- **Bloqueo huérfano o PID reutilizado**: se resuelve borrando `voice-operation.lock` a mano, como indica el mensaje.
- **Operaciones externas**: invocar el motor fuera del plugin no respeta el bloqueo y puede dejar locuciones mezcladas, reparables con `presynth --force`.
- **Denoise**: la preservación de identidad vocal no está validada.

### Trabajo futuro

- Perfiles de voz por evento.
- Voces por proyecto.
- Previsualizar una voz antes de activarla.
- Fallback controlado a `default`, opt-in.
- Limpieza automática de locuciones de voces retiradas.

## 14. Referencias

- `docs/INTEGRATION.md`: contrato actual del plugin con el motor.
- `README.md` y `SECURITY.md`: configuración, privacidad y modelo de amenazas.
- Motor: `docs/CLI/CONTRACT.md` (§5 despacho al daemon, §12 contratos externos).
- Motor: `docs/CLI/commands/VOICE.md`: `voice clone`, `voice list` y `voice remove`.
- Motor: `docs/CLI/commands/SPEECH.md`: `speech synthesize`, `speech say` y `speech play`.
- Motor: `docs/CLI/commands/DAEMON.md`: `--warm-voice` y residente de una sola voz.
