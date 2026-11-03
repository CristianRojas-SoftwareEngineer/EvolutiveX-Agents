# Política de seguridad

## Versiones soportadas

EvolutiveX Agents está en desarrollo activo pre-1.0. Solo la última versión publicada recibe correcciones de seguridad.

| Versión | Soportada |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1.0 | ❌        |

## Cómo reportar una vulnerabilidad

**No** reportes vulnerabilidades de seguridad en Issues públicos.

Usa el canal privado de [**GitHub Security Advisories**](https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents/security/advisories/new) para reportarlas de forma confidencial. Incluye:

- Una descripción de la vulnerabilidad y su impacto.
- Pasos para reproducirla (versión del plugin, versión del motor, SO, evento
  de hook o comando que la dispara).
- Cualquier mitigación conocida.

Recibirás una respuesta inicial en un plazo razonable. Te pedimos no divulgar públicamente el problema hasta que exista una corrección disponible.

Si la vulnerabilidad está en el motor de síntesis y no en el plugin, repórtala en el canal equivalente de [AI Voice-InterConnector](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/security/advisories/new) (ver su [SECURITY.md](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/main/SECURITY.md)).

## Modelo de amenaza

El plugin es un cliente delgado que corre dentro de la sesión de Claude Code del propio usuario, con sus mismos privilegios. Su superficie es pequeña, pero maneja dos cosas sensibles: **la API key opcional de Gemini** (solo en memoria, leída del entorno) y **contenido de la sesión**. Estos son sus supuestos, explícitos:

### Qué se persiste, dónde y con qué permisos

- El _state dir_ por SO (`%LOCALAPPDATA%\evolutivex-agents` en Windows, `${XDG_STATE_HOME:-~/.local/state}/evolutivex-agents` en Linux, `~/Library/Application Support/evolutivex-agents` en macOS) contiene `worker.pid` (el lock del worker), `queue/` (cola de payloads de narración, cada uno con el nombre de la voz con que narrarlo), `worker.log` y su rotación `worker.log.1`, `active-voice` (caché con el nombre de la voz activa, derivada de `/config`) y, mientras dura una operación manual de voz, `voice-operation.lock` (un directorio con el PID de su dueño). Las preferencias viven en el `userConfig` del plugin y la API key en el entorno: **ninguna se guarda aquí**.
- El clonado de voz es local: el plugin entrega al motor la **ruta** de la referencia (o le pide grabar del micrófono) y el motor guarda solo la huella del timbre en su propio almacén. El plugin **no copia, mueve ni borra la referencia**, no manipula audio y no guarda rutas de referencia: de una voz solo conoce su nombre, que es lo único que viaja en `userConfig`, la cola y `active-voice`. Ningún audio sale de la máquina.
- El canal de notificaciones de escritorio muestra extractos locales del evento (preview del prompt, herramienta/pregunta o último mensaje del asistente, truncados) en el centro de notificaciones del sistema operativo local. **Nunca envía datos por red**.
- La API key se lee únicamente de la variable de entorno `GEMINI_API_KEY` y vive en memoria durante la generación.
- La variable de entorno puede heredarse en procesos hijos y, si el usuario la define de forma persistente, queda en su perfil fuera del control del plugin. Esa decisión y su protección son responsabilidad del usuario.
- Los archivos transitorios en `queue/` y `worker.log` pueden contener extractos del último payload de hook; viven bajo el state dir y las protecciones del perfil de usuario del SO.
- El transcript enriquecido (opt-in) solo guarda la hora de inicio y la duración de cada bloque en el almacenamiento local que Claude Code da al plugin (un bucket por día, 30 días de retención y como máximo 3,5 MiB), para que una sesión reanudada muestre las mismas cifras. Ni el texto de los bloques ni ningún otro dato sale del equipo.

### Qué sale hacia terceros y bajo qué opt-in

- En modo `llm` — **que solo se activa si el usuario define `GEMINI_API_KEY` y fija `messageMode` en `llm` en `/config`**, es un opt-in explícito — solo la ruta `Stop` puede enviar contenido a un tercero: el `last_assistant_message` del payload (ni transcript ni historial) viaja a la API de Gemini (Google) para redactar la locución. Ese texto viaja **sin sanear**: el modelo necesita el markdown original para entender la estructura del turno, así que de él solo se acota el tamaño (`clampHead`), nunca el contenido. Trata el modo `llm` como lo que es: compartir el último mensaje completo del turno con un tercero. El saneo de `src/voice/message/sanitize.ts` se aplica a la salida del modelo y a la degradación local, nunca al material que sale: descarta el cuerpo de los bloques de código cercados, conserva el texto del código en línea (donde viajan las rutas y los identificadores) y elimina URLs, markdown y símbolos no narrables.
- Los eventos `Notification`, `SubagentStop`, `StopFailure` y `UserPromptSubmit` **nunca** usan el modo `llm`: da igual la configuración de `messageMode` o la clave presente, su locución es siempre un anuncio pre-sintetizado del catálogo (`src/voice/message/static-announcements.ts`), reproducido con `speech play` y sin invocar ningún proveedor. Es una barrera estructural, no una omisión: `Notification` en particular suele dispararse en contextos sensibles (peticiones de permiso, alertas) y su texto ya viene redactado por Claude Code, así que no hay valor en parafrasearlo y sí riesgo en enviarlo a un tercero. En consecuencia, en modo `llm` el único evento que puede llegar a salir a la red es `Stop`, y solo si hay material narrable y una clave configurada.
- En modo `local` (el comportamiento por defecto y el que se usa sin clave) **nada sale a la red**: el mensaje se construye de forma determinista y se sintetiza con el motor AI Voice-InterConnector, que es 100 % offline.
- La clave viaja **solo en el header** `x-goog-api-key`, nunca en la URL (que suele quedar en logs), y las peticiones van únicamente al endpoint oficial de Gemini. Esto está fijado por tests de contrato (`tests/gemini-provider.spec.ts`).

### Qué no hace el plugin

- **No pide ni maneja claves dentro del chat**: ni la skill ni el comando de instalación piden la clave en la conversación (evita que quede en el transcript); ambos guían al usuario a la variable de entorno.
- **No imprime el valor de una clave**: `narrate-ctl status` reporta solo `configurada`/`ausente`. Esta garantía está fijada por contrato en `tests/narrate-ctl.spec.ts`.
- **No manda nada a la red en modo `local`**, ni telemetría en ningún modo.
- **No ejecuta contenido de la sesión**: el payload de los hooks se parsea de forma tolerante (`src/lib/hook-payload.ts`) y su texto solo se usa como entrada de saneamiento o formato visual; los únicos procesos externos que el plugin lanza son el ejecutable `ai-voice-interconnector` resuelto del `PATH` (canal de voz) y el notificador nativo del sistema operativo vía `node-notifier`/`vendor/` o `reg.exe` en el registro opt-in de Windows (canal de escritorio), siempre sin evaluar shell sobre el contenido del turno.

### Cadena de suministro

- El plugin se distribuye clonando el repo con `dist/` y `vendor/` **commiteados**; lo que ejecutas es el JS del árbol de git. El CI verifica en cada push a una rama que `dist/` y `vendor/` coinciden exactamente con la compilación de `src/` (`npm run check-dist`); el pre-commit lo regenera al commitear y el checklist de release lo vuelve a comprobar. De este modo el fuente publicado y el artefacto ejecutado no pueden divergir sin que el pipeline falle.
- No requiere **`npm install` en la máquina del usuario final**: los bundles de `dist/` son autocontenidos (usan la stdlib de Node, `fetch` nativo y empaquetan `commander` y `node-notifier` junto con los binarios redistribuibles de `vendor/`; ver `NOTICE`). Las dependencias de construcción y verificación van fijadas por `package-lock.json`.
