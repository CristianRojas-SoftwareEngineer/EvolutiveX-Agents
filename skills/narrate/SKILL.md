---
name: narrate
description: Muestra el estado de la narración por voz de EvolutiveX Agents, narra texto a demanda, pre-sintetiza los anuncios y gestiona las voces (clonar, listar, borrar y activar); explica que las preferencias (narración, voz activa, notificaciones de escritorio, modo de generación y transcript enriquecido) se cambian en /config. Úsala cuando el usuario pida "léeme esto en voz alta", "narra ...", "activa/desactiva la narración", "activa/desactiva las notificaciones de escritorio", "cambia el modo de narración", "clona mi voz", "qué voces tengo", "usa mi voz", "vuelve a la voz predeterminada", "borra la voz X", o pregunte por el estado o la configuración del plugin.
---

# Narración por voz y notificaciones con EvolutiveX Agents

Esta skill opera el plugin **EvolutiveX Agents** (`evolutivex-agents`), que narra por voz la actividad de la sesión mediante AI Voice-InterConnector y emite notificaciones de escritorio nativas. La **automatización por turno** la manejan los hooks (no esta skill); aquí se cubre el **uso consciente**: estado, narración a demanda, pre-síntesis y voces, más la explicación de dónde se cambian las preferencias. Las operaciones pasan por un único script de control:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" <comando> [args]
```

Ejecuta ese comando con la herramienta de shell. Es multiplataforma (Node ya está presente por ser el runtime de Claude Code) y no requiere que AI Voice-InterConnector esté aprovisionado salvo para `say`, `presynth` y `voice`.

## Comandos

| Intención del usuario       | Comando                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| Ver el estado               | `narrate-ctl.js status`                                                   |
| Narrar un texto ahora       | `narrate-ctl.js say [--voice <nombre>] "texto a narrar"`                  |
| Pre-sintetizar los anuncios | `narrate-ctl.js presynth [--voice <nombre>]` (`--force` para re-sync)     |
| Ver las voces               | `narrate-ctl.js voice list`                                               |
| Clonar una voz              | `narrate-ctl.js voice clone <nombre> (<ruta.wav> \| --mic --duration 10)` |
| Borrar una voz clonada      | `narrate-ctl.js voice remove <nombre> --yes`                              |

Tras `status`, resume la salida sin volcar rutas si el usuario no las pidió. `status` no muestra las preferencias, porque la herramienta de shell no recibe los valores de `/config`, pero sí la **voz activa** según el último evento narrado. `say` y `presynth` usan esa misma voz si no reciben `--voice`, e informan de dónde salió.

## Voces

Para **clonar, listar o borrar** voces sigue el flujo del comando `/evolutivex-agents:voice`: explica la referencia (~10 s, máximo 30 s, WAV o micrófono) y la privacidad (el clonado es local y nada sale de la máquina), pide confirmación antes de clonar y de borrar, y ejecuta `voice clone` y `presynth` con el timeout de la herramienta de shell en 600000 ms. Para «usa mi voz» o «vuelve a la voz predeterminada», indica la opción `/config` → `evolutivex-agents.voice` (`default` para la predeterminada) y, si la voz no tiene sus anuncios, ejecuta antes `presynth --voice <nombre>`.

## Preferencias (en `/config`, no aquí)

Si el usuario pide activar o desactivar la voz o las notificaciones de escritorio, o cambiar la voz o el modo de generación, indícale la opción de `/config` que corresponde; el cambio se aplica desde el evento siguiente, sin reiniciar:

| Intención del usuario                   | Opción en `/config`                               |
| --------------------------------------- | ------------------------------------------------- |
| Activar/desactivar la narración por voz | `evolutivex-agents.voiceEnabled`                  |
| Cambiar la voz de la narración          | `evolutivex-agents.voice`                         |
| Activar/desactivar las notificaciones   | `evolutivex-agents.notificationsEnabled`          |
| Cambiar el modo de generación           | `evolutivex-agents.messageMode` (`local` o `llm`) |
| Activar/desactivar el transcript        | `evolutivex-agents.enhancedTranscript`            |

`presynth` pre-sintetiza de una vez los anuncios estáticos del plugin (acuse de `UserPromptSubmit` y fallbacks por evento) con `speech synthesize`, para que luego se reproduzcan al instante con `speech play`. Cada voz tiene sus propios anuncios: `presynth` usa la voz de `--voice` o, sin ella, la voz activa. Es **idempotente** (un anuncio ya pre-sintetizado no se re-sintetiza) y **requiere el daemon caliente**; normalmente lo ejecutan la instalación guiada y `voice clone`, y solo hay que re-ejecutarlo tras borrar la caché del motor o al activar una voz sin anuncios. Como los labels son slugs fijos, un **cambio de frase** de un anuncio no cambia su label, así que `presynth` a secas no lo detecta: para forzar la re-síntesis usa `presynth --force`, que pasa `--force` al motor y sobrescribe el WAV existente.

## Narración a demanda ("léeme esto")

Cuando el usuario pida narrar algo, **redacta tú un texto breve y natural en español** (una o dos frases, sin markdown ni símbolos, apto para leerse en voz alta) y pásalo a `say`. No narres bloques de código, rutas ni markdown crudo: parafrasea. Requiere que AI Voice-InterConnector esté instalado y aprovisionado (`ai-voice-interconnector setup`); si `say` reporta que el CLI no está en el PATH, indícalo.

## Configuración de claves (modo LLM)

El modo `llm` genera los mensajes con el nivel gratuito de **Gemini**. La clave
es del usuario. Por privacidad, **no pidas ni manejes la clave en el chat**
(quedaría en el transcript). En su lugar, guía al usuario a definir la variable
de entorno `GEMINI_API_KEY`; el plugin no la guarda en disco:

- **Windows (PowerShell, sesión actual)**: `$env:GEMINI_API_KEY = "..."`.
  Persistente: `setx GEMINI_API_KEY "..."` o Propiedades del sistema →
  Variables de entorno.
- **Linux/macOS (sesión actual)**: `export GEMINI_API_KEY=...`. Persistente:
  añadir el `export` a `~/.bashrc` o `~/.zshrc`.

Si la variable se define de forma persistente, hay que abrir una terminal nueva
o reiniciar Claude Code. Sin clave configurada, el modo `llm` degrada de facto a
`local`, que funciona 100 % offline con mensajes más simples.

## Privacidad (adviértelo al activar el modo LLM)

El modo `llm` envía el último mensaje del asistente a Google (Gemini), y solo en
la ruta `Stop`: no envía el transcript ni el historial. Es un cambio de postura
respecto al motor AI Voice-InterConnector, que sintetiza 100 % offline. Si el
usuario activa el modo `llm` o configura la clave, recuérdaselo en una frase y
menciona que `messageMode` en `local` evita cualquier envío externo.
