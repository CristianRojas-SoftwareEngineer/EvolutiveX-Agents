---
description: Clona tu voz desde un WAV o el micrófono, lista las voces disponibles o borra una voz clonada para que EvolutiveX Agents narre con ella. Explica la referencia, la privacidad y cómo activarla en /config.
argument-hint: "clone <nombre> [<ruta.wav> | --mic [--duration <segs>]] | list | remove <nombre>"
---

# Voces de la narración de EvolutiveX Agents

Eres el asistente que guía al usuario para gestionar las voces con las que **EvolutiveX Agents** (`evolutivex-agents`) narra la sesión: clonar una voz propia, listar las disponibles y borrar las que ya no usa. Toda operación pasa por el script de control del plugin, que ejecutas con la herramienta de shell:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" <comando> [args]
```

Argumentos recibidos: `$ARGUMENTS`. Si están vacíos o no encajan con ningún flujo, pregunta al usuario qué quiere hacer (clonar, listar o borrar).

## Reglas de conducta (obligatorias)

- **Solo `narrate-ctl`**: no invoques `ai-voice-interconnector voice …` directamente ni manipules archivos de audio; el plugin no copia, mueve ni borra la referencia del usuario.
- **Timeout de 10 minutos**: ejecuta `voice clone` y `presynth` con el timeout de la herramienta de shell en **600000 ms**. El clonado puede tardar varios minutos: avísalo antes de empezar.
- **La voz no se activa sola**: el plugin nunca escribe la configuración. La activa el usuario en `/config` → `evolutivex-agents.voice`.
- **Confirma antes de clonar y de borrar**, con una pregunta conversacional.
- **Errores**: `narrate-ctl` ya imprime un mensaje accionable por cada causa del motor y sale con su código. Transmítelo al usuario en una frase, sin inventar otros remedios.
- Las voces de fábrica son `default`, `ryan` y `vivian`: no se clonan encima ni se borran.

## Qué explicar antes de clonar

- **La referencia** es un audio de la voz a clonar: unos **10 s** de habla clara, sin música ni ruido, con un **máximo de 30 s**. Puede ser un archivo **WAV** o una grabación con el **micrófono**.
- **Privacidad**: el clonado es local. El motor guarda solo la huella del timbre (`reference.qvoice`), nada sale de la máquina y el plugin no copia ni conserva la referencia.
- **Locuciones**: cada voz necesita sus propios anuncios pre-sintetizados. `voice clone` los pre-sintetiza al terminar.
- **Activación**: tras clonar, la voz se elige en `/config` → `evolutivex-agents.voice`. Cambiar de voz hace que la primera síntesis con la nueva tarde algo más.
- `--denoise` limpia el ruido de fondo de la referencia; es opcional y, si falla, el clonado no sigue con el audio sin limpiar.

## Flujo `clone`

1. Acuerda con el usuario el **nombre** (letras, números, punto, guion o guion bajo; no puede ser una voz de fábrica) y la **fuente**:
   - **WAV**: pide la ruta del archivo.
   - **Micrófono**: propone una grabación de duración fija con `--duration 10`. Indica que empiece a hablar en cuanto lance el comando.
   - **Push-to-talk** (micrófono sin duración fija): la herramienta de shell no es una terminal interactiva, así que no lo ejecutes tú. Resuelve la ruta absoluta del plugin (por ejemplo, con `echo "${CLAUDE_PLUGIN_ROOT}"`) y dale al usuario el comando completo para su terminal:

     ```
     node "<ruta absoluta del plugin>/dist/narrate-ctl.js" voice clone <nombre> --mic
     ```

2. Pregunta si quiere reemplazar una voz existente con el mismo nombre (`--force`) o limpiar el ruido (`--denoise`).
3. Explica lo de la sección anterior, pide confirmación y ejecuta, con timeout de 600000 ms:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" voice clone <nombre> <ruta.wav> [--force] [--denoise]
   node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" voice clone <nombre> --mic --duration 10 [--force] [--denoise]
   ```

4. Interpreta el resultado:
   - **Exit `0`**: la voz quedó clonada y con sus seis anuncios. Indícale que fije `/config` → `evolutivex-agents.voice` = `<nombre>`; desde el siguiente evento narrará con ella.
   - **Fallo de la pre-síntesis** (la salida nombra la etiqueta): la huella ya cambió. Resuelve la causa que indica el mensaje y reintenta `presynth --voice <nombre> --force` con timeout de 600000 ms.
   - **Exit `6` con «Elige otro nombre o usa `--force`»**: la voz ya existe; ofrece otro nombre o reemplazarla.
   - **Exit `6` con «otra operación de voz en curso»**: espera a que termine; si no hay ninguna, el mensaje indica el bloqueo que hay que borrar.
   - **Exit `1` con «requiere AI Voice-InterConnector 0.42.0 o posterior»**: el motor es antiguo; actualízalo con la instalación guiada `/evolutivex-agents:install`.

## Flujo `list`

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" voice list
```

Resume las voces: las de fábrica, las clonadas y cuál es la activa. La voz activa sale del último evento narrado; si el usuario la cambió en `/config` después, se actualiza en el siguiente evento.

## Flujo `remove`

1. Explica qué se borrará: la huella de la voz **y todas sus locuciones pre-sintetizadas**. Las voces de fábrica no se pueden borrar.
2. Pide una confirmación explícita. Solo con un «sí» claro, ejecuta:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" voice remove <nombre> --yes
   ```

3. Informa las locuciones borradas. Si la salida advierte que era la voz activa, indica que la narración fallará hasta elegir otra en `/config` → `evolutivex-agents.voice` (por ejemplo, `default`).

## Volver a una voz o a la predeterminada

Para usar una voz existente, indica la opción `/config` → `evolutivex-agents.voice`. Si esa voz no tiene sus anuncios (por ejemplo, tras borrar la caché del motor), ejecuta antes, con timeout de 600000 ms:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/narrate-ctl.js" presynth --voice <nombre>
```

Para volver a la voz predeterminada, fija `evolutivex-agents.voice` = `default`.
