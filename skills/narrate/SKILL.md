---
name: narrate
description: Controla la narración por voz y las notificaciones de escritorio de EvolutiveX Agents (activar/desactivar canales, modo de generación, estado) y narra texto a demanda. Úsala cuando el usuario pida "léeme esto en voz alta", "activa/desactiva la narración", "activa/desactiva las notificaciones de escritorio", "cambia el modo de narración", "narra ...", o pregunte por el estado o la configuración del plugin, incluido cómo activar el transcript enriquecido (que se activa en /config).
---

# Narración por voz y notificaciones con EvolutiveX Agents

Esta skill opera el plugin **EvolutiveX Agents** (`evolutivex-agents`), que narra por voz la actividad de la sesión mediante AI Voice-InterConnector y emite notificaciones de escritorio nativas. La **automatización por turno** la manejan los hooks (no esta skill); aquí se cubre el **uso consciente**: toggles de ambos canales, modo, estado y narración a demanda. Todas las operaciones pasan por un único script de control:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" <comando> [args]
```

Ejecuta ese comando con la herramienta de shell. Es multiplataforma (Node ya está presente por ser el runtime de Claude Code) y no requiere que AI Voice-InterConnector esté aprovisionado salvo para `say`.

## Comandos

| Intención del usuario                | Comando                                            |
| ------------------------------------ | -------------------------------------------------- |
| Ver el estado y la configuración     | `narrate-ctl.js status`                            |
| Narrar un texto ahora                | `narrate-ctl.js say "texto a narrar"`              |
| Pre-sintetizar los anuncios          | `narrate-ctl.js presynth` (`--force` para re-sync) |

Tras `status`, resume la salida (no vuelques rutas si el usuario solo preguntó si está activa; los toggles se hacen en `/config` → `evolutivex-agents.*`).

`presynth` pre-sintetiza de una vez los anuncios estáticos del plugin (acuse de `UserPromptSubmit` y fallbacks por evento) con `speech synthesize`, para que luego se reproduzcan al instante con `speech play`. Es **idempotente** (un anuncio ya pre-sintetizado no se re-sintetiza) y **requiere el daemon caliente**; normalmente lo ejecuta la instalación guiada, y solo hay que re-ejecutarlo tras borrar la caché del motor. Como los labels son slugs fijos, un **cambio de frase** de un anuncio no cambia su label, así que `presynth` a secas no lo detecta: para forzar la re-síntesis usa `presynth --force`, que pasa `--force` al motor y sobrescribe el WAV existente.

## Narración a demanda ("léeme esto")

Cuando el usuario pida narrar algo, **redacta tú un texto breve y natural en español** (una o dos frases, sin markdown ni símbolos, apto para leerse en voz alta) y pásalo a `say`. No narres bloques de código, rutas ni markdown crudo: parafrasea. Requiere que AI Voice-InterConnector esté instalado y aprovisionado (`ai-voice-interconnector setup`); si `say` reporta que el CLI no está en el PATH, indícalo.

## Transcript enriquecido (no se controla aquí)

El transcript enriquecido (hora de inicio, duración y contadores en vivo en cada bloque del transcript) **no** se controla con `narrate-ctl`. Si el usuario pide activarlo o desactivarlo, indícale que lo haga desde `/config`, en la opción `evolutivex-agents.enhancedTranscript` (desactivada por defecto); el cambio se aplica al momento. Las preferencias de voz, notificaciones y modo también se configuran en `/config` → `evolutivex-agents.*`.

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
menciona que `mode local` evita cualquier envío externo.
