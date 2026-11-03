# Especificación de diseño: clonado de voz y voz activa

> **Estado**: propuesta, no implementada · **Versión base del plugin**: 0.1.0 ·
> **Contrato del motor verificado**: v0.42.0 · **Fecha**: 2026-11-02

La funcionalidad propuesta requiere como mínimo el motor v0.42.0, el único
corte contra el que el plugin se verifica; los fallos de micrófono y de audio
salen con exit 3 y `reason` propio (`no_input_device`, `no_output_device`,
`audio_backend_unavailable`).

Este documento analiza el requerimiento de exponer el clonado de voz del motor
AI Voice-InterConnector a través del plugin, fija el diseño y define los
criterios de aceptación. Es la fuente de verdad funcional de la feature; la
implementación, la documentación de usuario y los tests se derivan de él.

## Tabla de contenidos

- [1. Propósito](#1-propósito)
- [2. Alcance](#2-alcance)
- [3. Contexto actual](#3-contexto-actual)
- [4. Glosario](#4-glosario)
- [5. Requisitos](#5-requisitos)
- [6. Análisis de alternativas y decisiones](#6-análisis-de-alternativas-y-decisiones)
- [7. Diseño](#7-diseño)
- [8. Invariantes y casos límite](#8-invariantes-y-casos-límite)
- [9. Errores y mensajes](#9-errores-y-mensajes)
- [10. Estrategia de pruebas](#10-estrategia-de-pruebas)
- [11. Criterios de aceptación](#11-criterios-de-aceptación)
- [12. Documentación afectada](#12-documentación-afectada)
- [13. Riesgos y trabajo futuro](#13-riesgos-y-trabajo-futuro)
- [14. Referencias](#14-referencias)

---

## 1. Propósito

Permitir que el usuario narre la actividad de Claude Code con **su propia voz**
en lugar de la voz de fábrica `default`, sin romper la arquitectura actual del
plugin:

- el plugin sigue siendo un **cliente delgado** del motor;
- el motor sigue siendo el dueño del audio, del clonado y del almacén de voces;
- el plugin solo guarda el **nombre** de la voz activa;
- la voz se aplica de forma consistente a la pre-síntesis, a la reproducción de
  anuncios y a la síntesis dinámica del evento `Stop`.

## 2. Alcance

### Dentro del alcance

- Clonar una voz a partir de un archivo WAV de referencia o directamente desde el micrófono en vivo y asignarle un nombre.
- Ofrecer opcionalmente `--denoise` para cualquiera de las dos fuentes, sin activarlo por defecto.
- Listar las voces disponibles.
- Activar una voz y persistirla como preferencia no secreta.
- Pre-sintetizar los seis anuncios estáticos bajo la voz activa.
- Reproducir los anuncios y sintetizar el resumen de `Stop` con la voz activa.
- Arrancar el daemon con la voz activa como voz de calentamiento.
- Borrar voces de usuario con confirmación y protección de las voces de fábrica.
- Diagnosticar el estado de la voz activa.
- Guiar al usuario en la obtención de la referencia (archivo o micrófono) y en los requisitos del
  motor.
- Documentar el contrato ampliado y cubrirlo con tests.

### Fuera del alcance

- Capturar o procesar audio PCM directamente en el código TypeScript del plugin. La captura interactiva de micrófono o la lectura de archivo se delega íntegramente a la CLI del motor `ai-voice-interconnector voice clone`.
- Perfiles de voz por evento (`voice-stop`, `voice-notification`, etc.).
- Varias voces activas simultáneas o selección de voz por sesión.
- Entrenamiento, edición o fusión de voces.
- Clonado remoto: el motor es local y el audio de referencia no sale de la máquina.
- Migración automática de locuciones entre voces: no existe copia de WAVs entre
  namespaces de voz.

## 3. Contexto actual

Hoy el plugin **no selecciona voz**. Las tres rutas omiten `--voice`:

| Ruta            | Invocación actual                               |
| --------------- | ----------------------------------------------- |
| Pre-síntesis    | `speech synthesize --text … --label … --daemon` |
| Reproducción    | `speech play --label … --json`                  |
| `Stop` dinámico | `speech say --text … --daemon --json`           |

El motor resuelve la voz de fábrica `default` cuando `--voice` falta. `default`
es una voz clonada de fábrica con una huella `reference.qvoice` embebida; no es
un preset. Las locuciones se almacenan en el motor bajo la clave
`(voz, etiqueta)`, en `<data_dir>/speech/<voz>/<etiqueta>.wav`.

Consecuencias del diseño actual:

- no hay personalización;
- la pre-síntesis, la reproducción y la síntesis dinámica comparten la misma
  voz implícita;
- si se introduce una voz distinta en una sola ruta, las otras pueden reproducir
  `default` con otro timbre o fallar si falta la locución;
- `config.json` solo guarda `voiceEnabled`, `notificationsEnabled` y `messageMode`.

## 4. Glosario

| Término              | Definición                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Voz**              | Entrada del registro `VoiceStore` del motor. Puede ser de fábrica (`default`, `ryan`, `vivian`) o clonada por el usuario.                                                                                                                                    |
| **Voz clonada**      | Voz creada por `voice clone` a partir de una referencia de audio. El almacén de voces conserva la huella `reference.qvoice`, no el WAV; pueden existir temporales de trabajo.                                                                                |
| **Voz activa**       | Nombre de la voz que el plugin persiste en `config.json` y usa en todas las rutas de narración.                                                                                                                                                              |
| **Referencia**       | Muestra de audio que el usuario entrega a `voice clone` (archivo WAV o captura de micrófono). Se recomiendan ~10 s; el motor rechaza más de 30 s.                                                                                                            |
| **Huella de timbre** | Archivo `reference.qvoice` que produce el clonado. No contiene transcripción ni idioma.                                                                                                                                                                      |
| **Etiqueta**         | Identificador fijo de una locución pre-sintetizada (`voice-user-prompt-submit`, `voice-stop`, etc.).                                                                                                                                                         |
| **Locución**         | WAV pre-sintetizado y persistido por el motor bajo `(voz, etiqueta)`.                                                                                                                                                                                        |
| **Pre-síntesis**     | Ejecución única de `speech synthesize` para cada etiqueta del catálogo, con el fin de que `speech play` sea instantáneo.                                                                                                                                     |
| **Cache miss**       | `speech play` no encuentra la locución (`speech_not_found`) o la voz (`voice_not_found`) solicitadas; el motor sale con exit `3`. El mismo exit con `no_output_device` o `audio_backend_unavailable` no es cache miss, sino un problema del entorno de audio |
| **Denoise**          | Limpieza opcional con DPDFNet antes de extraer la huella; requiere `native-denoise` y `dpdfnet8`. Su preservación de identidad vocal no se ha evaluado en una prueba humana controlada.                                                                      |
| **`reason`**         | Identificador de error en el JSON; el exit code solo identifica la clase y puede compartirse entre causas distintas.                                                                                                                                         |
| **`precomputed`**    | En ruta daemon indica que se inició el calentamiento, no que haya terminado.                                                                                                                                                                                 |
| **`schema_version`** | Versión del envelope CLI, independiente de la versión del protocolo del daemon.                                                                                                                                                                              |

## 5. Requisitos

### 5.1 Requisitos funcionales

| ID        | Requisito                                                                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RF-01** | El plugin debe clonar delegando en `voice clone --name <nombre> (--speech-reference <wav> \| --mic [--duration <seg>]) [--force] [--denoise] --daemon --json`: exactamente una fuente y duración de 1 a 30 s solo con micrófono. |
| **RF-02** | El plugin debe validar el nombre y bloquear el clonado sobre voces de fábrica (`default`, `ryan`, `vivian`) en el MVP.                                                                                                           |
| **RF-03** | El plugin debe listar las voces disponibles con `voice list --json` y señalar cuál es la activa y cuáles son de fábrica.                                                                                                         |
| **RF-04** | El plugin debe permitir activar una voz existente y persistir su nombre en `config.json` como `voice`.                                                                                                                           |
| **RF-05** | La activación debe pre-sintetizar los seis anuncios bajo la voz candidata antes de persistirla; solo la configuración se conserva ante un fallo, no se revierten los WAV escritos.                                               |
| **RF-06** | La pre-síntesis manual (`narrate-ctl presynth`) debe usar la voz activa y aceptar `--force` para re-sintetizar tras cambios de texto o de timbre.                                                                                |
| **RF-07** | `speech play --label` debe ejecutarse con `--voice <activa>` en todos los hooks estáticos.                                                                                                                                       |
| **RF-08** | `speech say --text … --daemon` debe ejecutarse con `--voice <activa>` en la ruta `Stop` y en `narrate-ctl say`.                                                                                                                  |
| **RF-09** | El arranque del daemon debe pasar `daemon start --warm-voice <activa>` explícitamente, también para `default`.                                                                                                                   |
| **RF-10** | El plugin debe permitir borrar voces de usuario con confirmación explícita, protección de fábrica y protección de la voz activa.                                                                                                 |
| **RF-11** | El plugin debe mostrar la voz activa en `narrate-ctl status` y advertir en `SessionStart` si la voz activa no existe.                                                                                                            |
| **RF-12** | Si la voz activa no existe en tiempo de ejecución, el plugin no debe caer silenciosamente a otra voz: registra el fallo y deja el turno sin audio.                                                                               |
| **RF-13** | El plugin no debe copiar, mover ni borrar el archivo de referencia ni manipular buffers de micrófono; delega la I/O de audio al motor.                                                                                           |
| **RF-14** | El plugin no debe guardar audio, rutas de referencia ni secretos en `config.json`.                                                                                                                                               |
| **RF-15** | La feature debe ser opt-in: una instalación sin clonado debe seguir funcionando exactamente como hoy con `default`.                                                                                                              |
| **RF-16** | La documentación del plugin debe explicar los requisitos de la referencia (archivo o micrófono en vivo), la privacidad y el costo de cambiar de voz.                                                                             |

### 5.2 Requisitos no funcionales

| ID         | Requisito                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **RNF-01** | Sin dependencias nuevas de runtime: solo Node.js y la CLI del motor.                                                                        |
| **RNF-02** | El launcher de hooks no debe invocar `voice list`, `voice clone` ni el daemon: sigue saliendo en menos de 100 ms y solo encola.             |
| **RNF-03** | La lógica de nombres, parseo de `voice list` y construcción de argumentos debe ser pura y testeable sin motor.                              |
| **RNF-04** | Toda la operación debe pasar por `narrate-ctl`; no se crean scripts paralelos ni se duplica la lógica en el comando de Claude Code.         |
| **RNF-05** | Los timeouts de las invocaciones al motor deben respetar el presupuesto de `SessionStart` (30 s).                                           |
| **RNF-06** | Los errores se interpretan por operación, exit y `reason`, con reserva genérica para razones desconocidas; nunca se muestra un stack trace. |
| **RNF-07** | El comportamiento debe ser idéntico en Windows, Linux y macOS, incluidas rutas con espacios y shims `.cmd` en Windows.                      |
| **RNF-08** | `lint`, `format:check`, `typecheck`, `test` y `check-dist` deben pasar en CI en los tres sistemas.                                          |

## 6. Análisis de alternativas y decisiones

### 6.1 Superficie de control

| Alternativa                                                                     | Valoración                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extender `narrate-ctl` con una familia `voice` y añadir un comando `/voice`** | **Elegida.** Una sola implementación determinista, testeable con CLI falso, coherente con `voice-on/voice-off/notifications-on/notifications-off/mode/say/presynth`. El comando de Claude Code solo explica y orquesta. |
| Script separado `voice-ctl.js`                                                  | Duplica resolución de CLI, config y manejo de errores. Descartada.                                                                                                                                                      |
| Solo skill, sin CLI determinista                                                | El modelo construiría comandos a mano; difícil de testear y de mantener. Descartada.                                                                                                                                    |

### 6.2 Ruta de clonado

| Alternativa                           | Valoración                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **`voice clone … --daemon`**          | **Elegida.** El daemon dispara warm-on-clone en segundo plano; `precomputed` no garantiza que haya terminado.            |
| `voice clone … --no-daemon`           | Funciona, pero carga el modelo en un proceso efímero y no precalienta al daemon. Se reserva para troubleshooting manual. |
| Fallback automático de daemon a local | Añade latencia impredecible y dos caminos que probar. Descartado en el MVP.                                              |

### 6.3 Momento de la pre-síntesis

| Alternativa                                                                | Valoración                                                                                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **`voice use` pre-sintetiza con `--force` y solo después persiste la voz** | **Elegida.** Evita persistir la candidata antes de seis éxitos; los WAV escritos no se revierten si falla a mitad.      |
| Pre-síntesis perezosa en el primer `play`                                  | El primer turno quedaría sin audio o pagaría una síntesis dentro de la ruta caliente. Descartada.                       |
| `presynth` idempotente sin `--force`                                       | No detecta un re-clonado del mismo nombre ni un cambio de texto: dejaría WAVs obsoletos. Descartada para la activación. |

El costo aceptado es seis síntesis por cambio de voz. Es una operación manual y
poco frecuente; la latencia no afecta a los hooks.

### 6.4 Cambio de voz y daemon

El residente TTS del motor es de una sola voz: al sintetizar con otra voz,
termina el residente anterior y arranca uno nuevo. Por eso:

- **no hace falta reiniciar el daemon** al cambiar de voz;
- la pre-síntesis de `voice use` ya deja caliente la voz nueva;
- en `SessionStart`, si el daemon está parado, se arranca con la voz activa;
- si el daemon ya está corriendo, no se reinicia: la primera síntesis con otra
  voz paga el cold-start de reemplazo.

### 6.5 Política de fallback

| Alternativa                            | Valoración                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sin fallback automático en runtime** | **Elegida.** Mantiene una voz activa global sin mutar la configuración cuando desaparece; un cambio manual puede dejar un elemento en curso con la voz anterior. |
| Caer a `default` en `play`/`say`       | Robusto, pero puede producir una locución con una voz distinta a la elegida. Se deja como mejora futura.                                                         |
| Auto-reparar `config.json` a `default` | Sorprende al usuario y oculta la causa. Descartada.                                                                                                              |

### 6.6 Decisiones cerradas

| ID       | Decisión                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-01** | Una sola voz activa global, persistida como `voice` en `config.json`.                                                                                           |
| **D-02** | `narrate-ctl` expone `voice list`, `voice clone`, `voice use` y `voice remove`; el comando `/evolutivex-agents:voice` es la capa de explicación y confirmación. |
| **D-03** | `voice clone` usa siempre el daemon en el MVP.                                                                                                                  |
| **D-04** | `voice use` valida la voz, pre-sintetiza con `--force` y solo entonces escribe la configuración.                                                                |
| **D-05** | La voz activa se pasa siempre de forma explícita (`--voice`), incluido `default`, para no depender del default implícito del motor.                             |
| **D-06** | Las voces de fábrica no se clonan encima ni se borran desde el plugin.                                                                                          |
| **D-07** | La voz activa no se puede borrar: primero hay que activar otra.                                                                                                 |
| **D-08** | `voice remove` exige `--yes` en `narrate-ctl`; el comando de Claude Code pide la confirmación conversacional.                                                   |
| **D-09** | No hay fallback automático a `default` en runtime. `SessionStart` avisa si la voz activa no existe.                                                             |
| **D-10** | El plugin no guarda audio, rutas de referencia ni secretos; solo el nombre de la voz.                                                                           |
| **D-11** | `sessionStart` arranca el daemon con `--warm-voice <activa>` solo cuando está parado y la voz existe.                                                           |
| **D-12** | `--denoise` es optativo, sin fallback a audio sin limpiar; la calidad de identidad vocal no se ha validado en una prueba humana controlada.                     |
| **D-13** | Las operaciones manuales de clonado, activación, borrado, pre-síntesis y escritura de preferencias se coordinan entre procesos del plugin.                      |
| **D-14** | `SessionStart` comprueba la voz activa no predeterminada incluso con daemon en marcha.                                                                          |
| **D-15** | La instalación ofrece una pregunta opcional de clonado y la funcionalidad requiere motor v0.42.0 o posterior.                                                   |

## 7. Diseño

### 7.1 Configuración

`config.json` incorpora un único campo nuevo, no secreto:

```json
{
  "voiceEnabled": true,
  "notificationsEnabled": true,
  "messageMode": "local",
  "voice": "default"
}
```

Reglas:

- `voice` ausente, vacío o inválido → `"default"` (compatibilidad con
  instalaciones existentes).
- Un nombre válido cuya voz desapareció no se sustituye: se avisa y se conserva la configuración.
- Se normaliza a minúsculas y se recorta.
- `loadConfig()` no consulta al motor; solo lee el archivo y el entorno.
- `updateConfig()` acepta `voice` en el parche y lo persiste.
- `narrate-ctl status` muestra `voice: <nombre>`.
- No se guardan la ruta del WAV ni `reference.qvoice`.

### 7.2 Módulo `src/voice/voice.ts`

Nuevo módulo puro, sin I/O:

```ts
export const DEFAULT_VOICE = "default";
export const FACTORY_VOICES = ["default", "ryan", "vivian"] as const;

export function normalizeVoiceName(raw: string): string;
export function isPlausibleVoiceName(name: string): boolean;
export function isFactoryVoice(name: string): boolean;
export function parseVoiceListOutput(text: string): string[] | undefined;
```

Responsabilidades:

- normalizar y validar nombres de forma conservadora;
- rechazar nombres vacíos, de más de 64 caracteres, con `..`, separadores o caracteres distintos de letras y números ASCII, punto, guion y guion bajo;
- reconocer las voces de fábrica;
- parsear `{"voices": ["default", ...]}` y rechazar shapes inválidos;
- no duplicar las reglas profundas del motor: el motor sigue siendo la
  autoridad final sobre el nombre, el audio y la duración.

### 7.3 Superficie `narrate-ctl`

```text
node dist/narrate-ctl.js voice list
node dist/narrate-ctl.js voice clone <nombre> <ruta.wav> [--force] [--denoise]
node dist/narrate-ctl.js voice clone <nombre> --mic [--duration <segs>] [--force] [--denoise]
node dist/narrate-ctl.js voice use <nombre>
node dist/narrate-ctl.js voice remove <nombre> --yes
node dist/narrate-ctl.js status
node dist/narrate-ctl.js presynth [--force]
node dist/narrate-ctl.js say "<texto>"
```

Comportamiento:

- **`voice list`**: ejecuta `voice list --json`; imprime todas las voces, marca
  la activa y las de fábrica.
- **`voice clone`**:
  - Valida nombre y bloquea voces de fábrica.
  - Si se pasa `<ruta.wav>`: valida que el archivo exista; ejecuta
    `ai-voice-interconnector voice clone --name <nombre> --speech-reference <ruta.wav> [--force] [--denoise] --daemon --json`.
  - Si se pasa `--mic`: en terminal interactiva (TTY) o con `--duration <segs>`,
    ejecuta `ai-voice-interconnector voice clone --name <nombre> --mic [--duration <segs>] [--force] [--denoise] --daemon --json`
    heredando stdin y stderr para permitir push-to-talk y capturando stdout para interpretar el envelope JSON. Esta disposición también se prueba con shims `.cmd`.
  - `--denoise` se transmite solo si se solicita; requiere `native-denoise` y `dpdfnet8`, sin degradar a audio sin limpiar.
  - Si el motor devuelve `voice_exists` sin `--force`, informa exit `6`; no atribuye ese significado a otros errores con el mismo exit.
  - Si hay `--force` y la voz es la activa, re-sintetiza con `presynth --force`.
- **`voice use`**: verifica que la voz exista con `voice list --json`; ejecuta
  la pre-síntesis forzada de las seis etiquetas; solo si todas terminan bien
  escribe `voice` en `config.json`.
- **`voice remove`**: exige `--yes`; rechaza voces de fábrica y la voz activa;
  ejecuta `voice remove --name <nombre> --yes --json` y reporta las locuciones
  arrastradas.
- **`presynth`**: usa `cfg.voice`; añade `--voice`, `--daemon` y `--json` para capturar el resultado; sin `--force`, solo `reason: label_exists` con exit `6` cuenta como éxito idempotente. Si una invocación falla, identifica la etiqueta y termina con código distinto de cero.
- **`say`**: usa `cfg.voice`; añade `--voice` a `speech say --daemon`.
- **`status`**: incluye `voice: <nombre>` además de los campos actuales.

El comando de Claude Code puede orientar al usuario, pero no debe prometer una
TTY para procesos lanzados por la herramienta de shell del host. La captura sin
duración solo se ofrece cuando stdin es realmente una terminal interactiva; en
caso contrario se requiere `--duration` o una terminal del usuario. El proceso
que ejecuta `narrate-ctl` debe devolver un error si el hijo no se inició, fue
terminado por señal o agotó su timeout, nunca interpretar `status: null` como 0.

### 7.4 Flujo de clonado

```text
Usuario
  │  /evolutivex-agents:voice clone <nombre> [<ruta.wav> | --mic [--duration <seg>]]
  ▼
Comando Claude Code
  │  1. valida explicación y confirmación (o guía de grabación de micrófono)
  │  2. invoca narrate-ctl voice clone
  ▼
narrate-ctl
  │  3. comprueba CLI, nombre, argumento de entrada y voces de fábrica
  │  4. ejecuta voice clone --name … (--speech-reference … | --mic …) [--denoise] --daemon --json
  │  5. interpreta {name, speech, precomputed}
  │  6. si --force y la voz es la activa → presynth --force
  ▼
Motor AI Voice-InterConnector
  │  Adquiere audio (lee WAV o graba de cpal vía avi-audio)
  │  VoiceStore::save_reference(nombre, reference.qvoice)
  │  warm-on-clone de la voz nueva en segundo plano
  ▼
Usuario recibe: voz creada y siguiente paso (voice use <nombre>)
```

Detalles:

- Se recomienda una referencia de ~10 s; el motor acepta hasta 30 s (tanto en archivo como en micrófono).
- El motor no conserva el WAV en `VoiceStore`. El daemon usa un WAV temporal en scratch, que se limpia en salidas controladas; una terminación forzosa o fallo del filesystem puede dejar residuos. El WAV del usuario permanece intacto.
- En ruta daemon el cliente captura antes del POST y el daemon detecta la colisión autoritativa después de la captura.
- `precomputed: true` significa «precarga en caliente iniciada», no que la voz
  esté lista para el primer uso.
- Si el nombre ya existe y no hay `--force`, no se sobrescribe nada.
- Si se sobrescribe la voz activa, la pre-síntesis forzada es obligatoria para
  que las locuciones no conserven el timbre anterior.
- Si falla esa pre-síntesis, la huella nueva ya está guardada y puede haber locuciones antiguas o parcialmente renovadas; se informa y se indica reintentar `presynth --force`.
- El plugin no activa automáticamente la voz recién clonada.

### 7.5 Flujo de activación

```text
voice use <nombre>
  │
  ├─ ¿nombre válido? ── no → exit 2
  ├─ ¿voz existe? ──── no → exit 3
  ├─ ¿daemon disponible? ─ no → exit 5 con remedio
  │
  ├─ presynth --force --voice <nombre>  (seis etiquetas)
  │     ├─ exit 0 → etiqueta sintetizada
  │     ├─ exit 6 → conflicto, no se acepta como éxito con --force
  │     └─ otro   → fallo; no se toca config
  │
  └─ updateConfig({ voice: <nombre> })
```

Solo la actualización de configuración se pospone hasta los seis éxitos. Los
WAV ya escritos no se revierten; un reintento forzado los sobrescribe de nuevo.
Si la candidata ya era la activa, durante la operación o tras un fallo pueden
coexistir locuciones antiguas y nuevas. Las operaciones externas al plugin no
quedan incluidas en la serialización ni en esta garantía.

### 7.6 Flujo de pre-síntesis

Para cada entrada de `ANNOUNCEMENTS`:

```bash
ai-voice-interconnector speech synthesize \
  --text "<texto>" \
  --label "<label>" \
  --voice "<voz activa>" \
  --daemon \
  --json \
  [--force]
```

- `--force` se usa en `voice use` y en `presynth --force`.
- Sin `--force`, únicamente exit `6` con `reason: label_exists` se considera éxito idempotente; cualquier otro conflicto es fallo.
- Un cambio de texto del catálogo no cambia el label: hay que ejecutar
  `presynth --force` para re-sintetizar.
- Un re-clonado del mismo nombre con `--force` no cambia el label: también exige
  `presynth --force`.

### 7.7 Rutas de runtime

`buildMessage()` no cambia: sigue decidiendo **qué** se narra (etiqueta o
texto). La voz es una preocupación de transporte y se añade en el worker y en
`narrate-ctl`.

| Componente                                    | Cambio                                                   |
| --------------------------------------------- | -------------------------------------------------------- |
| `src/voice/narrate-worker.ts` → `runPlay`     | `speech play --label <label> --voice <cfg.voice>`        |
| `src/voice/narrate-worker.ts` → `runSay`      | `speech say --text <texto> --voice <cfg.voice> --daemon` |
| `src/narrate-ctl.ts` → `say`                  | `speech say --text <texto> --voice <cfg.voice> --daemon` |
| `src/narrate-ctl.ts` → `presynth`             | `speech synthesize … --voice <cfg.voice> --daemon`       |
| `src/voice/daemon.ts` → `startDaemonDetached` | acepta `warmVoice` y añade `--warm-voice`                |

`buildMessage()` no debe recibir ni devolver la voz. Esto evita mezclar la
selección editorial del mensaje con la identidad de la voz.

### 7.8 `SessionStart` y daemon

`health-check` amplía su orden actual, sin bloquear la sesión:

1. `doctor --json`.
2. `daemon status --json` solo si el diagnóstico es sano.
3. Si el estado es `running` o `stopped` limpio y la voz activa no es `default`, se valida con `voice list --json` tanto con daemon parado como en marcha; si no existe, se emite `systemMessage` y no se arranca. JSON inválido, timeout o error de listado no demuestran que la voz falte: se informa el diagnóstico incierto y no se arranca.
4. Si el daemon está parado y la voz existe, `daemon start --warm-voice <voz activa>`; si está corriendo, no se reinicia.
5. `degraded` o estado incierto no se tratan como parado limpio; `warm_failed` se comunica sin reiniciar.
6. Si el daemon está corriendo con otra voz, la primera síntesis paga el
   cold-start de reemplazo; no se reinicia por eso.

Presupuesto: `doctor` ≤20 s + `daemon status` ≤5 s + `voice list` ≤2 s = 27 s;
los 3 s restantes incluyen Node, stdin y resolución del ejecutable dentro del
timeout de 30 s. Estas cifras no garantizan por sí solas el plazo: el hook debe
aplicar un deadline global y limitar cada consulta al menor entre su timeout y
el tiempo restante, incluyendo el drenaje de stdin. El arranque desanclado no se
espera. La validación de voz se omite para `default`. `doctor` es
integral: incluye receipt, PATH, residuos y los seis modelos, incluido
`dpdfnet8`; el daemon puede arrancar con los otros cinco si no se usa denoise.
`daemon restart` calienta `default`, no conserva `--warm-voice`.

### 7.9 Borrado de voces

`voice remove` es destructivo: el motor borra la voz y **arrastra sus
locuciones**. El plugin:

1. exige `--yes` en `narrate-ctl`;
2. rechaza voces de fábrica antes de invocar al motor;
3. rechaza la voz activa y pide activar otra primero;
4. invoca `voice remove --name <nombre> --yes --json`;
5. reporta `removed_speech` para que el usuario sepa qué locuciones se borraron.

El comando de Claude Code pide confirmación explícita y muestra el aviso de
arrastre antes de ejecutar.

### 7.10 Contrato del motor ampliado

Además de las seis superficies actuales, el plugin consumirá tres comandos de
voz y `version --json` para comprobar la versión mínima:

| Superficie                                                                                                             | Uso                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `voice clone --name <n> (--speech-reference <wav> \| --mic [--duration <segs>]) [--force] [--denoise] --daemon --json` | Clonado desde una fuente obligatoria.                                  |
| `voice list --json`                                                                                                    | Listado y validación de la voz activa.                                 |
| `voice remove --name <n> --yes --json`                                                                                 | Borrado de una voz de usuario.                                         |
| `version --json`                                                                                                       | Comprobación de versión mínima antes de habilitar la gestión de voces. |

Además, se añaden flags a superficies existentes:

- `--voice <n>` en `speech synthesize`, `speech say` y `speech play`;
- `--warm-voice <n>` en `daemon start`.

El contrato debe documentar los campos y códigos de salida que el plugin
consume:

| Operación           | Salida relevante                              | Códigos                                                                                                                                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice clone`       | `{name, speech, precomputed, schema_version}` | `0`; `1` `voice_clone_failed`/`io_error`/`denoise_unsupported`/`denoise_failed`; `2` nombre/audio/duración/no-tty/`empty_audio`; `3` `audio_not_found`/`no_input_device`/`audio_backend_unavailable`; `4` modelo; `5` daemon; `6` `voice_exists` o `denoise_busy`; `10` `transcription_failed` (otro fallo de captura); `17` lifecycle |
| `voice list`        | `{voices: string[]}`                          | `0`; `1` listado                                                                                                                                                                                                                                                                                                                       |
| `voice remove`      | `{status, voice, removed_speech}`             | `0`; `1` io; `2` fábrica/nombre; `3` voz no encontrada                                                                                                                                                                                                                                                                                 |
| `speech synthesize` | `{status, audio_path, voice}`                 | `0`; `6` label existente; `4`/`5`/`3` precondiciones                                                                                                                                                                                                                                                                                   |
| `speech say`        | `{status, voice}`                             | `0`; `1` `playback_failed`/`synthesis_failed`; `3` voz o `no_output_device`/`audio_backend_unavailable`; `4`/`5` precondiciones                                                                                                                                                                                                        |
| `speech play`       | `{status, label, voice}`                      | `0`; `1` `playback_failed`; `2` identificador; `3` `speech_not_found`/`voice_not_found`/`no_output_device`/`audio_backend_unavailable`                                                                                                                                                                                                 |

La feature requiere motor v0.42.0 o posterior. Antes de habilitar la gestión de
voces, el plugin consulta `version --json` y compara la versión; ante una
versión inferior o ilegible informa que la feature no está disponible y conserva
las rutas de narración existentes con `default`. La consulta no se añade al
launcher.
Los envelopes CLI incluyen `schema_version: "6"`; claves adicionales se toleran.
`voice list`, `voice remove` y `speech play` son locales y no aceptan `--daemon`.
`speech say` y `speech synthesize` admiten hasta 500 caracteres Unicode.

### 7.11 UX

Se añade `commands/voice.md`:

```text
/evolutivex-agents:voice clone <nombre> [<ruta.wav> | --mic [--duration <segs>]]
/evolutivex-agents:voice list
/evolutivex-agents:voice use <nombre>
/evolutivex-agents:voice remove <nombre>
```

El comando debe explicar en español:

- qué es una referencia de voz y cuánto debe durar (~10 s, máx 30 s);
- que se puede clonar pasando un archivo WAV o grabando directamente desde el micrófono con `--mic`;
- que el motor guarda solo el timbre (`reference.qvoice`), no el audio;
- que la voz no se activa sola;
- que cambiar de voz re-sintetiza los anuncios;
- que borrar una voz borra sus locuciones;
- que el audio de referencia no se sube a ninguna nube.

Se extiende `skills/narrate/SKILL.md` con la sección de voces para que el modelo
reconozca intenciones como «clona mi voz», «usa mi voz» o «vuelve a la voz
predeterminada» y las enrute a `narrate-ctl`.

El instalador guiado añade un paso opcional después de la pre-síntesis de
`default`: si el usuario acepta, clona su voz (guiándolo con micrófono o archivo)
y ejecuta `voice use`. Si no acepta, `default` queda lista para la narración.

### 7.12 Concurrencia

- El launcher de hooks no cambia: sigue encolando y lanzando el worker.
- `voice use` es una operación manual; puede convivir con un worker en curso.
  Un ítem ya reclamado puede narrarse con la voz anterior; el siguiente lee la
  configuración nueva. Es una ventana aceptable.
- El motor serializa síntesis, pero no la secuencia completa del plugin. Por cada directorio de estado, el plugin coordina `voice clone`, `voice use`, `voice remove`, `presynth` y las escrituras de preferencias `voice-on`, `voice-off`, `notifications-on`, `notifications-off` y `mode`, desde antes de leer la configuración relevante hasta completar las mutaciones. Las operaciones externas no participan.
- La coordinación usa dos directorios hermanos dentro de `stateDir()`: `voice-operation.lock` es el bloqueo principal y `voice-operation.gate` es la compuerta de sus cambios. Ambos se crean mediante `mkdir` exclusivo, sin `recursive`: `EEXIST` nunca concede propiedad. Todos los procesos del plugin adquieren la compuerta antes de crear, examinar, recuperar o liberar el bloqueo principal; nadie opera sobre este fuera de ella.
- Bajo la compuerta, el dueño del bloqueo principal escribe un registro con su PID, identidad de proceso verificable y token aleatorio único. Solo comienza a modificar configuración o locuciones después de escribir el registro completo y liberar la compuerta. Si la publicación falla, no ejecuta la operación y conserva cualquier estado que no pueda retirar con seguridad.
- Antes de despachar cada operación del motor que pueda modificar voces o locuciones, el dueño marca de forma persistente y bajo la compuerta que existe trabajo delegado pendiente; solo elimina esa marca tras recibir y procesar el resultado terminal. Si el dueño desaparece con la marca presente, el bloqueo se conserva para intervención manual: en particular, el daemon puede completar un clonado después de que el cliente se desconecte. La muerte del proceso del plugin por sí sola no prueba que haya cesado el trabajo delegado.
- Si el bloqueo principal existe, se lee su registro bajo la compuerta. Un dueño vivo o de identidad no verificable bloquea la operación sin mutar; solo tras comprobar que la identidad registrada ya no corresponde a un proceso vivo se vuelve a comprobar el mismo registro y se retira. La comprobación y el reemplazo ocurren con la compuerta aún adquirida. Un PID reutilizado nunca autoriza a tratar el proceso nuevo como dueño anterior. Un registro ausente, incompleto o ilegible es estado incierto y no se elimina automáticamente.
- Para liberar el bloqueo principal, el dueño vuelve a adquirir la compuerta, comprueba que el registro conserva su token e identidad y solo entonces lo retira. Si no puede comprobarlo, no borra nada y comunica el fallo. La pre-síntesis interna de `voice use` y del reclonado de la voz activa reutiliza el bloqueo ya adquirido, sin adquirirlo de nuevo.
- La compuerta se mantiene únicamente durante las transiciones del bloqueo principal, no durante la síntesis. Si está ocupada, la operación termina con error accionable sin modificar datos. Si un proceso termina mientras mantiene la compuerta, esta no se recupera automáticamente: se indica cerrar todas las operaciones manuales del plugin y verificar que no queden procesos participantes antes de retirarla manualmente. No se elimina una compuerta cuyo dueño pueda seguir activo.
- La observación de identidad es trivalente: dueño coincidente vivo, dueño anterior confirmado terminado o identidad incierta. Un error de permisos, observación no disponible o PID no verificable se clasifica como incierto; no se reutiliza `isAlive()` como prueba de muerte, porque reduce errores distintos de `EPERM` a falso. El mecanismo concreto de observación debe cumplir el mismo contrato en los tres sistemas, sin añadir dependencias de runtime.
- Los tests multiproceso deben demostrar exclusión durante adquisición, recuperación y liberación; interrupción antes de publicar el registro, interrupción con la compuerta adquirida, muerte con trabajo delegado pendiente, recuperación simultánea, PID reutilizado, errores de observación y reintento manual seguro. Si una plataforma no permite verificar la identidad, conserva el bloqueo y exige intervención; no inventa una confirmación de muerte.
- El worker no toma ese bloqueo: una locución en curso puede terminar con la configuración anterior o ver WAV parcialmente renovados; una operación externa puede modificar el almacén durante cualquier flujo.
- El daemon admite una limpieza DPDFNet activa y una espera de hasta 30 s; la saturación devuelve `denoise_busy`.
- La cola FIFO y el lock `worker.pid` no se tocan.

## 8. Invariantes y casos límite

1. **Una voz activa global**: cada operación usa la voz leída de `config.voice`; un elemento ya reclamado puede completar con la voz anterior.
2. **Activación condicionada**: `voice use` no persiste la voz hasta seis éxitos; no garantiza permanencia de los WAV ante fallos o cambios externos.
3. **No hay copia de locuciones entre voces**: cambiar de voz no reutiliza WAVs
   de `default` ni de otra voz; por eso la pre-síntesis es obligatoria.
4. **Las voces de fábrica son intocables desde el plugin**: no se clonan encima
   ni se borran.
5. **La voz activa no se borra**: primero hay que activar otra.
6. **El audio de referencia es del usuario**: el plugin no lo copia, no lo mueve y
   no lo borra.
7. **Sin secretos en configuración**: `config.json` solo contiene preferencias.
8. **Sin fallback silencioso**: si la voz activa desaparece, se avisa en
   `SessionStart` y se registra el fallo; no se cambia de timbre en caliente.
9. **Re-clonar no actualiza locuciones por sí solo**: hace falta
   `presynth --force`.
10. **El daemon no se reinicia por cambiar de voz**: el residente se reemplaza
    bajo demanda y la pre-síntesis lo deja caliente.
11. **La voz no altera el contenido del mensaje**: `buildMessage()` sigue siendo
    independiente de la voz.
12. **Un fallo de voz no bloquea el turno**: se registra y el turno sigue sin
    audio, como cualquier fallo del motor.

## 9. Errores y mensajes

| Condición                                  | Origen                                                        | Acción del plugin                              | Mensaje orientativo                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CLI no encontrado                          | `resolveCli()`                                                | No invoca nada; exit 1                         | «AI Voice-InterConnector no está en el PATH.»                                                            |
| Daemon caído en clone/use/presynth/say     | Motor exit `5`                                                | No reintenta en local; exit 5                  | «Levanta el daemon con `ai-voice-interconnector daemon start`.»                                          |
| Modelo Base ausente                        | Motor exit `4`                                                | Exit 4                                         | «Ejecuta `ai-voice-interconnector setup`.»                                                               |
| WAV no encontrado                          | Plugin                                                        | Exit 3; no invoca al motor                     | «La ruta de referencia no existe.»                                                                       |
| WAV inválido o >30 s                       | Motor exit `2`                                                | Exit 2                                         | «Usa un audio de hasta 30 s; se recomiendan ~10 s.»                                                      |
| `--mic` sin `--duration` en entorno no-TTY | Motor exit `2`                                                | Exit 2                                         | «`--mic` requiere `--duration <segs>` en entornos desatendidos.»                                         |
| Fallo de hardware de micrófono             | Motor exit `3` `no_input_device`/`audio_backend_unavailable`  | Exit 3                                         | «No hay micrófono predeterminado o falta el backend de audio: revisa `ai-voice-interconnector devices`.» |
| Otro fallo de captura                      | Motor exit `10` `transcription_failed`                        | Exit 10                                        | «No se pudo capturar audio del micrófono: verifica permisos y conexión.»                                 |
| Nombre inválido                            | Plugin/Motor exit `2`                                         | Exit 2                                         | «Usa minúsculas, números, punto, guion o guion bajo.»                                                    |
| Voz ya existe sin `--force`                | Motor exit `6`                                                | Exit 6                                         | «Elige otro nombre o usa `--force` para reemplazarla.»                                                   |
| Voz de fábrica                             | Plugin                                                        | Exit 2; no invoca                              | «`default`, `ryan` y `vivian` son voces de fábrica.»                                                     |
| Voz inexistente en `use`                   | Motor exit `3`                                                | Exit 3                                         | «Consulta `voice list` y elige una voz existente.»                                                       |
| Label existente sin `--force`              | Motor exit `6`, `label_exists`                                | Éxito idempotente                              | «Ya pre-sintetizado.»                                                                                    |
| Label o voz ausente en `play`              | Motor exit `3` `speech_not_found`/`voice_not_found`           | Log en `worker.log`; sin audio                 | «Ejecuta `presynth` o revisa la voz activa.»                                                             |
| Sin salida de audio en `play`/`say`        | Motor exit `3` `no_output_device`/`audio_backend_unavailable` | Log en `worker.log` con el `reason`; sin audio | «Configura una salida de audio predeterminada.»                                                          |
| Voz activa eliminada externamente          | `SessionStart`                                                | `systemMessage`; no arranca daemon             | «La voz activa no existe; activa otra con `voice use` o vuelve a `default`.»                             |
| Borrar voz activa                          | Plugin                                                        | Exit 2; no invoca                              | «Activa otra voz antes de borrar esta.»                                                                  |
| JSON inválido del motor                    | Plugin                                                        | Exit 1; log                                    | «El motor devolvió una respuesta inesperada.»                                                            |
| Captura vacía                              | `2 empty_audio`                                               | Exit 2                                         | «No se capturó audio.»                                                                                   |
| Duración o techo excesivo                  | `2 audio_too_long`                                            | Exit 2                                         | «El máximo de clonado es 30 s.»                                                                          |
| WAV truncado o inválido                    | `2 invalid_audio`                                             | Exit 2                                         | «Usa un WAV válido.»                                                                                     |
| Ciclo de vida ocupado                      | `17 lifecycle_locked`                                         | Exit 17; no se ejecuta                         | «Espera a que termine la instalación o limpieza.»                                                        |
| Limpieza ocupada                           | `6 denoise_busy`                                              | Exit 6; no confundir con `voice_exists`        | «Reintenta al terminar la limpieza en curso.»                                                            |
| Limpieza no disponible o fallida           | `1 denoise_unsupported` / `denoise_failed`                    | Exit 1; sin fallback                           | «Comprueba la instalación y el modelo de limpieza.»                                                      |
| Modelo de limpieza ausente                 | `4 model_missing`                                             | Exit 4                                         | «Ejecuta setup.»                                                                                         |
| Proceso no iniciado, señal o timeout       | Plugin                                                        | Fallo, nunca éxito por status nulo             | «No se pudo completar la operación.»                                                                     |

Los errores JSON incluyen `reason` y mensaje; se interpreta el código junto con
la operación y el `reason`. Una razón desconocida conserva el código y recibe
un mensaje genérico. En `speech play` y `speech say`, el exit 3 distingue con
`--json` `speech_not_found` (solo `play`), `voice_not_found`,
`no_output_device` y `audio_backend_unavailable`; el worker del plugin ya
registra ese `reason` en `worker.log`. `doctor` con veredicto negativo devuelve
su informe y exit 1, no necesariamente un objeto de error.

## 10. Estrategia de pruebas

### 10.1 Unitarias

- `tests/voice.spec.ts`
  - normalización de nombres;
  - voces de fábrica;
  - parseo válido e inválido de `voice list --json`;
  - validación conservadora de nombres.
- `tests/config.spec.ts`
  - `voice` por defecto;
  - lectura de configs antiguas sin `voice`;
  - persistencia de `voice` sin secretos;
  - valores inválidos → `default`.
- `tests/narrate-ctl.spec.ts`
  - argumentos de `voice clone` (archivo y `--mic`), `voice list`, `voice use`, `voice remove`;
  - `voice use` usa `presynth --force` y no escribe config si falla;
  - `voice remove` exige `--yes`, bloquea fábrica y voz activa;
  - `voice clone --force` sobre la voz activa dispara `presynth --force`;
  - `presynth`, `say` y `status` usan la voz activa;
  - mapeo de exit codes.
- `tests/narrate-worker.spec.ts`
  - `play` incluye `--voice`;
  - `say` incluye `--voice`;
  - la cola y el lock no cambian.
- `tests/daemon.spec.ts`
  - `startDaemonDetached` añade `--warm-voice` cuando se pasa voz.
- `tests/health-check.spec.ts`
  - arranca con la voz activa si el daemon está parado;
  - no arranca si la voz activa no existe;
  - emite `systemMessage` de voz ausente;
  - respeta el presupuesto de timeouts.

### 10.2 Integración con CLI falso

Usar el patrón actual de `tests/helpers.ts` y un CLI falso que:

- registre `argv` en un archivo;
- permita programar códigos de salida por comando;
- emita JSON de `voice list`, `voice clone`, `voice remove`;
- simule fallos de pre-síntesis en una etiqueta concreta.

Casos:

1. clonar una voz nueva desde archivo WAV;
2. clonar una voz nueva desde micrófono (`--mic` con y sin `--duration`);
3. nombre ocupado con y sin `--force`;
4. activar una voz y verificar las seis llamadas con `--voice`;
5. fallo de pre-síntesis sin escritura de configuración y con WAV parciales;
6. reproducir y narrar con la voz activa;
7. arrancar el daemon con `--warm-voice`;
8. borrar una voz de usuario;
9. borrar la voz activa: rechazo;
10. voz activa ausente en `SessionStart`;
11. motor sin soporte de `voice`: mensaje de función no disponible.
12. fuente ausente o duplicada y duración sin micrófono; límites 0, 1, 30 y 31.
13. TTY y no-TTY, variable PTT ausente, inválida, válida y superior a 30; stdin interactivo y stdout JSON separados.
14. `--denoise` con modelo ausente, `denoise_busy` y fallo, sin fallback; exit 6 con razones distintas.
15. `lifecycle_locked`, captura vacía, fallo al lanzar proceso, señal, timeout y razón desconocida.
16. `voice remove --json` reporta `removed_speech`; `voice use` de voz activa con fallo deja estado parcial informado.
17. operaciones manuales simultáneas, recuperación simultánea de dueño terminado, PID reutilizado, dueño no verificable y liberación sin propiedad; verificar que nunca haya dos dueños.
18. voz ausente con daemon activo, `degraded`, `warm_failed` y veredicto integral de `doctor`.
19. versión inferior a v0.42.0 o ilegible no habilita la feature y mantiene narración existente.
20. `presynth` concurrente con `voice use` y `voice-on`/`voice-off`/`notifications-on`/`notifications-off`/`mode` concurrentes con `voice use`: sin WAV ni preferencias perdidas por carreras del plugin; sin bloqueo reentrante en pre-síntesis interna.

### 10.3 E2E opcional

Con el motor real, en una máquina de desarrollo:

1. clonar una voz de prueba (desde micrófono o archivo WAV);
2. activarla;
3. verificar que los seis anuncios suenan con esa voz;
4. narrar un `Stop` dinámico;
5. volver a `default`;
6. borrar la voz.

No se ejecuta en CI porque requiere modelos y audio. Registrar cada ruta y
plataforma no ejecutada y su motivo; enumerar dispositivos de salida no acredita
que exista un micrófono de entrada.

### 10.4 Gates

- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm test`
- `npm run check-dist`
- `claude plugin validate --strict .`
- CI de CircleCI en Linux, Windows y macOS.

## 11. Criterios de aceptación

| ID        | Dado                                                                                                              | Cuando                                             | Entonces                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-01** | Una configuración existente sin `voice`                                                                           | Se carga la configuración                          | `voice` es `"default"` y todas las rutas siguen funcionando como hoy.                                                                                      |
| **AC-02** | CLI, daemon, WAV válido y nombre libre                                                                            | Se ejecuta `voice clone nombre ref.wav`            | Exit 0; el motor recibe `voice clone --name nombre --speech-reference ref.wav --daemon --json`; `config.json` no cambia.                                   |
| **AC-03** | CLI, daemon, micrófono y nombre libre                                                                             | Se ejecuta `voice clone nombre --mic --duration 5` | Exit 0; el motor recibe `voice clone --name nombre --mic --duration 5 --daemon --json`; `config.json` no cambia.                                           |
| **AC-04** | Un nombre de voz ya existente                                                                                     | Se clona sin `--force`                             | Exit 6, no se sobrescribe y el mensaje ofrece `--force`.                                                                                                   |
| **AC-05** | Un nombre ya existente y `--force`                                                                                | Se clona                                           | El motor recibe `--force`; si la voz es la activa, se ejecuta `presynth --force`; si esa pre-síntesis falla, se informa y no se deja un estado silencioso. |
| **AC-06** | Un nombre de fábrica (`default`, `ryan`, `vivian`)                                                                | Se intenta clonar o borrar                         | Exit 2 antes de invocar al motor; no se modifica nada.                                                                                                     |
| **AC-07** | Un WAV inexistente o un nombre inválido                                                                           | Se clona                                           | Exit 3 o 2 respectivamente; no se invoca al motor.                                                                                                         |
| **AC-08** | CLI y daemon disponibles                                                                                          | Se ejecuta `voice list`                            | Exit 0; se listan todas las voces, marcando la activa y las de fábrica.                                                                                    |
| **AC-09** | Una voz existente y daemon disponible                                                                             | Se ejecuta `voice use nombre`                      | Se llama `voice list --json`; se ejecuta `speech synthesize --voice nombre --force` para las seis etiquetas; solo después se persiste `voice`; exit 0.     |
| **AC-10** | Una pre-síntesis falla durante `voice use`                                                                        | Se activa la voz                                   | La configuración conserva la voz anterior; exit distinto de 0; se informa la etiqueta fallida.                                                             |
| **AC-11** | Una voz activa configurada                                                                                        | Se ejecuta `presynth`                              | Cada `speech synthesize` incluye `--voice <activa> --daemon`; solo `label_exists` sin `--force` cuenta como éxito; `--force` añade `--force`.              |
| **AC-12** | Una voz activa configurada                                                                                        | El worker narra un evento estático                 | `speech play --label <label> --voice <activa>`; no requiere daemon.                                                                                        |
| **AC-13** | Una voz activa configurada                                                                                        | El worker narra un `Stop` dinámico                 | `speech say --text <texto> --voice <activa> --daemon`.                                                                                                     |
| **AC-14** | Una voz activa configurada y daemon parado                                                                        | `SessionStart` diagnostica un entorno sano         | El arranque incluye `daemon start --warm-voice <activa>`.                                                                                                  |
| **AC-15** | Una voz activa que no existe                                                                                      | `SessionStart`                                     | Se emite `systemMessage`; no se arranca el daemon con la voz ausente; no se muta `config.json`.                                                            |
| **AC-16** | Una voz de usuario no activa                                                                                      | Se ejecuta `voice remove nombre --yes`             | Se llama `voice remove --name nombre --yes --json`; se reportan las locuciones arrastradas; exit 0.                                                        |
| **AC-17** | La voz activa                                                                                                     | Se intenta `voice remove`                          | Exit 2 sin invocar al motor; se pide activar otra voz primero.                                                                                             |
| **AC-18** | `voice remove` sin `--yes`                                                                                        | Se ejecuta                                         | Exit 2 sin invocar al motor.                                                                                                                               |
| **AC-19** | Una instalación sin clonado                                                                                       | Se ejecuta el instalador                           | La pregunta de clonado es opcional; al rechazarla, `default` queda pre-sintetizada y funcional.                                                            |
| **AC-20** | Un cambio de texto en el catálogo                                                                                 | Se ejecuta `presynth --force`                      | Las seis locuciones se re-sintetizan con la voz activa.                                                                                                    |
| **AC-21** | Un re-clonado del mismo nombre                                                                                    | Se ejecuta `voice use nombre`                      | La pre-síntesis forzada actualiza el timbre de las seis locuciones.                                                                                        |
| **AC-22** | Uso normal de la feature                                                                                          | Se inspecciona `config.json`                       | No contiene audio, rutas de referencia, claves ni secretos; solo `voiceEnabled`, `notificationsEnabled`, `messageMode` y `voice`.                          |
| **AC-23** | Un hook se dispara                                                                                                | Se mide el launcher                                | Sigue por debajo de 100 ms y no ejecuta `voice list`, `voice clone` ni `daemon`.                                                                           |
| **AC-24** | Windows, Linux y macOS                                                                                            | Se ejecutan los tests                              | Pasan los mismos casos, incluidas rutas con espacios y shims `.cmd` en Windows.                                                                            |
| **AC-25** | La implementación termina                                                                                         | Se ejecutan los gates                              | `lint`, `format:check`, `typecheck`, `test` y `check-dist` pasan; `claude plugin validate --strict .` pasa; CI verde.                                      |
| **AC-26** | La implementación termina                                                                                         | Se revisa la documentación                         | `docs/INTEGRATION.md`, `README.md`, `SECURITY.md`, `CHANGELOG.md` y este documento reflejan la feature y las nuevas superficies.                           |
| **AC-27** | Un motor anterior a v0.42.0 o versión ilegible                                                                    | Se invoca la feature                               | Se informa que no está disponible y se conserva la narración existente con `default`.                                                                      |
| **AC-28** | Una fuente WAV o micrófono                                                                                        | Se clona con `--denoise`                           | Se transmite el flag; ausencia de modelo, saturación o fallo se informan sin clonar audio sin limpiar.                                                     |
| **AC-29** | Motor corregido, TTY y variable PTT ausente                                                                       | Se clona con `--mic` sin duración                  | El límite es 30 s; la captura real solo se verifica con dispositivo disponible.                                                                            |
| **AC-30** | Una operación manual tiene el bloqueo                                                                             | Otra intenta clonar, activar o borrar              | No muta y comunica el conflicto; un dueño no verificable no se elimina automáticamente.                                                                    |
| **AC-31** | Diagnóstico sano, voz activa no predeterminada ausente y daemon activo                                            | Se inicia sesión                                   | Se avisa sin cambiar la configuración ni reiniciar el daemon.                                                                                              |
| **AC-32** | Reclonado de voz activa completado y falla una síntesis                                                           | Termina el comando                                 | Se informa que la huella ya cambió y que pueden quedar WAV mezclados; se indica `presynth --force`.                                                        |
| **AC-33** | `voice use` con seis síntesis forzadas                                                                            | Una falla                                          | La configuración no se escribe; los WAV ya escritos no se revierten, incluso si la candidata era la activa.                                                |
| **AC-34** | `voice use` y una escritura `voice-on`, `voice-off`, `notifications-on`, `notifications-off` o `mode` simultáneas | Ambas operaciones terminan                         | La configuración conserva ambas actualizaciones; ninguna sobrescribe preferencias leídas antes de adquirir el bloqueo.                                     |
| **AC-35** | Dos procesos intentan recuperar el mismo bloqueo de un dueño terminado                                            | Compiten con otra operación manual                 | Se verifica que nunca haya dos dueños simultáneos; un dueño de identidad no verificable no se elimina.                                                     |
| **AC-36** | `voice list` falla o devuelve JSON inválido durante `SessionStart`                                                | Se consulta una voz no predeterminada              | Se informa diagnóstico incierto, no se afirma que la voz no existe y no se arranca el daemon.                                                              |
| **AC-37** | `narrate-ctl voice clone --mic` sin duración y sin TTY                                                            | Se invoca el comando                               | Exit 2 con orientación; no se inicia la captura.                                                                                                           |
| **AC-38** | Un proceso termina durante la recuperación y deja la compuerta                                                    | Otra operación manual intenta ejecutarse           | No entra ni borra la compuerta; informa que debe verificarse y retirarse manualmente tras cerrar las operaciones participantes.                            |
| **AC-39** | Un bloqueo tiene registro ausente, ilegible o de identidad no verificable                                         | Se intenta recuperar                               | Se conserva y se informa; ningún error de observación se interpreta como muerte.                                                                           |
| **AC-40** | El dueño termina con un clonado o síntesis delegados sin resultado terminal                                       | Otra operación intenta recuperar el bloqueo        | Conserva el bloqueo e informa intervención manual; no presupone que la muerte del cliente canceló el trabajo del daemon.                                   |

## 12. Documentación afectada

| Documento                     | Cambio                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `docs/specs/VOICE_CLONING.md` | Este documento.                                                                                           |
| `docs/INTEGRATION.md`         | Nuevas superficies, flags `--voice`/`--warm-voice`, códigos de salida y requisitos.                       |
| `README.md`                   | Ejemplo de `config.json` con `voice`; comandos de voz; privacidad.                                        |
| `SECURITY.md`                 | La referencia de voz es local; el plugin no la copia ni la envía a la nube.                               |
| `CHANGELOG.md`                | Entrada de la feature.                                                                                    |
| `commands/install.md`         | Paso opcional de clonado y activación.                                                                    |
| `commands/voice.md`           | Nuevo comando de usuario.                                                                                 |
| `skills/narrate/SKILL.md`     | Intenciones de voz y enrutamiento a `narrate-ctl`.                                                        |
| `docs/ROADMAP.md`             | Retirar la idea de perfiles de voz si se implementa esta fase; dejar los perfiles por evento como futuro. |

## 13. Riesgos y trabajo futuro

### Riesgos

- **Costo de `presynth --force`**: seis síntesis por cambio de voz. Es una
  operación manual y poco frecuente; se acepta a cambio de consistencia.
- **Cold-start del daemon al cambiar de voz**: el residente es de una sola voz;
  la primera síntesis tras un cambio externo puede tardar. La pre-síntesis lo
  mitiga.
- **Re-clonado del mismo nombre**: si el usuario reemplaza una voz activa, las
  locuciones viejas quedan obsoletas hasta `presynth --force`. El flujo lo
  automatiza, pero un fallo deja un estado que hay que reparar.
- **Borrado destructivo**: `voice remove` arrastra las locuciones. La
  confirmación y la protección de la voz activa son obligatorias.
- **Deriva del contrato del motor**: las superficies de voz no estaban en el
  contrato estable del plugin; hay que documentarlas y verificarlas.
- **Modelo Base**: el clonado y las voces clonadas requieren
  `qwen3-tts-0.6b-base`; sin él, el motor sale con exit 4.
- **Permisos de micrófono**: al clonar con `--mic`, si el sistema operativo no concede permisos al proceso del motor, sale con exit 3 (`no_input_device` o `audio_backend_unavailable`) cuando falta el dispositivo o el backend, o con exit 10 (`transcription_failed`) ante otro fallo de captura. La UX debe informar con claridad cómo conceder permisos o usar un archivo WAV alternativo.
- **Concurrencia externa y recuperación**: el bloqueo del plugin no controla invocaciones externas; una interrupción puede dejar locuciones parciales o temporales para barrido.
- **Denoise**: `denoise_busy` comparte exit 6 con otros conflictos; no se ha validado en evaluación humana controlada la preservación de identidad.

### Trabajo futuro

- Perfiles de voz por evento.
- Varias voces activas por perfil o por proyecto.
- Limpieza automática de locuciones de voces retiradas.
- Previsualización de voz antes de activarla (`voice test`).
- Fallback controlado a `default` si la voz activa desaparece.
- La comprobación de versión mínima forma parte del alcance de esta propuesta.

## 14. Referencias

- `docs/INTEGRATION.md` — contrato actual del plugin con el motor.
- `README.md` — configuración, privacidad y comandos.
- `SECURITY.md` — modelo de amenazas y credenciales.
- Motor: `docs/CLI/CONTRACT.md` §3, §5 y §12.
- Motor: `docs/CLI/commands/VOICE.md` — `voice clone`, `voice list`, `voice remove`.
- Motor: `docs/CLI/commands/SPEECH.md` — `speech synthesize`, `speech say`, `speech play`.
- Motor: `docs/CLI/commands/DAEMON.md` — `--warm-voice` y residente de una sola voz.
- Motor: `docs/CLI/commands/DOCTOR.md` y `SETUP.md` — diagnóstico integral y selección de modelos.
- Motor: `docs/specs/VOICE_CLONING.md` y `crates/avi-shared/src/paths.rs` — captura y pines vigentes.
- Motor: `docs/DESIGN.md` — clonación por huella de timbre y modelo Base.
