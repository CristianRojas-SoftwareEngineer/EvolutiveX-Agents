# Revisión: fiabilidad y seguridad de EvolutiveX Agents

## Resumen ejecutivo

Auditoría de fiabilidad y seguridad de **EvolutiveX Agents**, plugin de Claude Code, sobre el commit `3035494` de la rama `main`. Se identificaron **16 hallazgos pendientes de corrección**: 7 de impacto alto (S3), 7 medio (S2) y 2 bajo (S1); no se identificaron hallazgos S4 ni S0. Se recomienda priorizar la privacidad y la exclusión mutua, seguidas de la persistencia, las notificaciones y los controles de release.

Las verificaciones reproducen mecanismos bajo condiciones aisladas, no demuestran que todos los impactos hayan ocurrido en sesiones de usuarios ni miden la frecuencia natural de las carreras. La evidencia y los límites específicos acompañan a cada hallazgo. Ninguna de las correcciones propuestas se ha implementado como parte de esta auditoría.

## Contexto y alcance

El plugin tiene tres funciones principales: narración de eventos mediante AI Voice-InterConnector, notificaciones de escritorio y, de forma opcional, un transcript enriquecido con horas y duraciones. Los hooks de comando reciben eventos de Claude Code; el canal de voz encola payloads en disco y un proceso desanclado —el _worker_— los consume. El transcript usa hooks de función y el almacenamiento `$.store` proporcionado por Claude Code. Los ajustes del plugin se exponen en `/config`.

La revisión examinó `src/voice/`, `src/lib/`, `src/narrate-ctl.ts`, `src/notifications/`, `src/transcript/`, pruebas, manifiestos, documentación, build, dependencias y configuración de CI. Se buscaron tanto defectos observables como condiciones que podrían ocasionarlos. La revisión es una fotografía del commit indicado, no una certificación de seguridad ni una garantía de ausencia de otros problemas.

## Método e interpretación

Se contrastaron fuentes y contratos con pruebas aisladas en Windows 11, Claude Code 2.1.321 y Node.js 24, el kit oficial de pruebas de Claude Code, y un contenedor Linux `node:24-bookworm-slim`. Según el caso, se usaron funciones o procesos reales, dobles del host, entradas sintéticas, un servidor local o barreras que fuerzan una intercalación entre procesos. Los `fetch` de prueba se interceptaron: no se enviaron datos a Gemini. La naturaleza de cada prueba importa: una intercalación forzada demuestra que una secuencia es posible, no cuán frecuente es; una sonda del host no equivale a ejecutar íntegramente el componente de producción.

Las rutas `archivo:línea` son relativas a la raíz del repositorio en el commit auditado. Los tipos en `.claude-plugin/types/` son generados localmente y no están versionados; `node_modules/` depende de la instalación. Los artefactos temporales identificados al final son evidencia auxiliar local, no archivos distribuidos con el proyecto ni una garantía de disponibilidad futura.

### Criterios de clasificación

- **Severidad**: S0 informativo, S1 impacto bajo y localizado, S2 impacto medio, S3 impacto alto en una propiedad importante y S4 impacto crítico. Mide el impacto si el problema se materializa, no su probabilidad ni el esfuerzo de corrección.
- **Prioridad**: P0 inmediato o bloqueante; P1 siguiente; P2 programable; P3 backlog. Es una recomendación de orden y puede cambiar sin cambiar la severidad.
- **Confianza**: describe qué parte del mecanismo se observó y con qué límites; no equivale a probabilidad de ocurrencia. **Decisión requerida** señala que la alternativa de corrección necesita una elección de diseño. **Pendiente** significa que aún no se ha implementado y verificado una remediación; no significa que falte toda evidencia del problema.

En los apartados siguientes, «evidencia» identifica las fuentes; «causa» describe el mecanismo; «impacto» diferencia lo observado de sus consecuencias posibles. Las correcciones son candidatas, no diseños aprobados.

## Índice de hallazgos

| ID    | Título                                                     | Severidad  | Prioridad | Área/plataforma           | Decisión requerida | Estado    |
| ----- | ---------------------------------------------------------- | ---------- | --------- | ------------------------- | ------------------ | --------- |
| S3-01 | Configuración obsoleta en el worker                        | S3 — Alto  | P1        | Voz/privacidad            | Sí                 | Pendiente |
| S3-02 | Recuperación no atómica del lock del worker                | S3 — Alto  | P1        | Voz/concurrencia          | Sí                 | Pendiente |
| S3-03 | Recuperación no atómica del lock de operaciones            | S3 — Alto  | P1        | Voz/concurrencia          | Sí                 | Pendiente |
| S3-04 | Eventos pendientes al finalizar el worker                  | S3 — Alto  | P1        | Voz/cola                  | No                 | Pendiente |
| S3-05 | Volcado del store pisa datos posteriores                   | S3 — Alto  | P1        | Transcript/persistencia   | Sí                 | Pendiente |
| S3-06 | Contenido sensible en argumentos y errores de notificación | S3 — Alto  | P1        | Notificaciones/privacidad | Sí                 | Pendiente |
| S3-07 | Payloads completos en cola con permisos heredados          | S3 — Alto  | P1        | Voz/privacidad            | Sí                 | Pendiente |
| S2-01 | Inicio de subagente atribuido al agente principal          | S2 — Medio | P2        | Transcript                | No                 | Pendiente |
| S2-02 | Promesa de carga del store no se recupera                  | S2 — Medio | P2        | Transcript                | Sí                 | Pendiente |
| S2-03 | El worker silencia excepciones al salir                    | S2 — Medio | P2        | Voz/observabilidad        | No                 | Pendiente |
| S2-04 | Cola no garantiza FIFO entre procesos                      | S2 — Medio | P2        | Voz/concurrencia          | Sí                 | Pendiente |
| S2-05 | Errores de SnoreToast pueden parecer éxito                 | S2 — Medio | P2        | Notificaciones/Windows    | Sí                 | Pendiente |
| S2-06 | Formato de cadenas de accesos directos incorrecto          | S2 — Medio | P2        | Notificaciones/Windows    | Sí                 | Pendiente |
| S2-07 | Smoke previo no identifica el commit etiquetado            | S2 — Medio | P2        | Release/CI                | Sí                 | Pendiente |
| S1-01 | Reparación de mojibake puede dañar Unicode                 | S1 — Bajo  | P2        | Notificaciones            | No                 | Pendiente |
| S1-02 | Gate de vendor y metadatos de release incompletos          | S1 — Bajo  | P2        | Build/documentación       | Sí                 | Pendiente |

## Hallazgos por severidad

### S3 — Altos

#### S3-01 — Configuración obsoleta en el worker

- **Categoría**: Seguridad y fiabilidad. **Área/plataforma**: voz, todas.
- **Evidencia**: `src/voice/narrate-hook.ts:29-49`, `src/voice/narrate-worker.ts:256-263`, `src/lib/config.ts:43-60`, `src/voice/queue.ts:30-33`.
- **Confianza**: Alta, reproducida en TUI real aislada; incidencia en uso normal no medida. **Causa**: el worker conserva su entorno heredado y solo recibe la voz en cada ítem. En Claude Code 2.1.321 aislado, al cambiar `messageMode` de `llm` a `local` en `/config` dentro de la ventana de inactividad, una sonda del siguiente `UserPromptSubmit` registró `local`; el mismo worker procesó el `Stop` posterior e invocó un segundo `fetch` interceptado. En el control, al esperar el cierre del worker, se creó otro y solo hubo un `fetch`. Las respuestas del asistente y el servicio de generación eran sintéticos. **Impacto**: durante la ventana de inactividad un `Stop` posterior puede procesarse con el modo anterior. No se envió tráfico a Gemini.
- **Corrección propuesta**: transmitir y aplicar una instantánea de configuración efectiva por ítem, o diseñar otra sincronización fiable sin persistir secretos (recomendada: seleccionar tras contrastar el contrato y privacidad). **Decisión requerida**: Sí. **Prioridad**: P1.

#### S3-02 — Recuperación no atómica del lock del worker

- **Categoría**: Fiabilidad. **Área/plataforma**: cola y procesos.
- **Evidencia**: `src/voice/narrate-worker.ts:141-163`, `src/voice/queue.ts:99-114`.
- **Confianza**: Alta en la intercalación instrumentada; frecuencia no medida. **Causa**: leer, borrar y recrear el lock no es atómico; un archivo recién creado también puede observarse vacío. Dos procesos reales, sincronizados tras leer el dueño obsoleto, adquirieron sucesivamente el lock y permanecieron vivos simultáneamente. Dos consumidores pueden leer el mismo ítem y ambos usarlo, aunque esa consecuencia no se reprodujo en esta prueba. **Impacto**: narraciones duplicadas o simultáneas posibles.
- **Corrección propuesta**: rediseñar adquisición y recuperación con identidad verificable y reclamación exclusiva (recomendada), probando intercalaciones y recuperación. **Decisión requerida**: Sí. **Prioridad**: P1.

#### S3-03 — Recuperación no atómica del lock de operaciones

- **Categoría**: Fiabilidad. **Área/plataforma**: gestión de voces.
- **Evidencia**: `src/voice/operation-lock.ts:32-45,57-64`.
- **Confianza**: Alta en la intercalación instrumentada; frecuencia no medida. **Causa**: dos procesos pueden decidir borrar el mismo dueño muerto y uno borrar el nuevo lock del otro; la liberación tampoco valida el dueño. Dos procesos reales, sincronizados después de identificar al dueño obsoleto, ejecutaron simultáneamente sus callbacks protegidos. **Impacto**: operaciones de voz simultáneas pese a la exclusión prevista.
- **Corrección propuesta**: protocolo de propiedad y recuperación segura (recomendada), con pruebas concurrentes; evaluar garantías del sistema de archivos. **Decisión requerida**: Sí. **Prioridad**: P1.

#### S3-04 — Eventos pendientes al finalizar el worker

- **Categoría**: Fiabilidad. **Área/plataforma**: cola de narración.
- **Evidencia**: `src/voice/narrate-worker.ts:296-305,315-324`, `src/voice/narrate-hook.ts:41-49`.
- **Confianza**: Alta en la intercalación instrumentada; incidencia real no medida. **Causa**: un hook puede encolar después de la última lectura vacía pero antes de liberar el lock, observar el worker vivo y no iniciar otro. Una sonda con procesos reales y reloj instrumentado encoló en esa ventana: el control consumió el ítem y el tratamiento dejó un JSON pendiente al salir el worker. **Impacto**: evento retenido hasta otro hook, potencialmente descartado por TTL; la sonda no estima frecuencia.
- **Corrección propuesta**: coordinar la entrega de propiedad y la comprobación final de la cola (recomendada), con test que controle la intercalación. **Decisión requerida**: No. **Prioridad**: P1.

#### S3-05 — Volcado del store pisa datos posteriores

- **Categoría**: Gestión de datos. **Área/plataforma**: transcript.
- **Evidencia**: `src/transcript/timing-store.ts:64-87,139-163`, `src/transcript/timing-store.test.ts:48-65`.
- **Confianza**: Alta en la secuencia controlada; no se ejecutó el `flush` original en dos hosts simultáneos. **Causa**: `flush` prioriza el bucket diario cacheado sin releer modificaciones posteriores de otra sesión. Con el bundle del plugin y el kit oficial, una entrada añadida al store simulado tras la carga desapareció en el volcado. Por separado, una **sonda de módulo distinta del plugin** comprobó el comportamiento del host real: B escribió `{"b":1}`, C lo leyó y, tras escribir A una copia anterior con `{"a":1}`, D leyó solo `{"a":1}`. **Impacto**: bajo esa intercalación pueden perderse horas y duraciones de otra sesión; la frecuencia en uso normal no se midió. Una relectura sin operación atómica podría dejar una carrera más estrecha.
- **Corrección propuesta**: comprobar garantías de `$.store` y adoptar un esquema de escritura aislada o coordinación apropiada (recomendada), con test de dos sesiones. **Decisión requerida**: Sí. **Prioridad**: P1.

#### S3-06 — Contenido sensible en argumentos y errores de notificación

- **Categoría**: Seguridad. **Área/plataforma**: notificaciones; log especialmente Linux.
- **Evidencia**: `src/notifications/hook-payload-notification-message.ts:98-110,150-163`, `src/notifications/dispatcher.ts:51-58`, `src/notifications/delivery.ts:65-67,147-153`, `node_modules/node-notifier/notifiers/notifysend.js:84-98`, `SECURITY.md:33-38,48-53`.
- **Confianza**: Alta para los mecanismos ensayados. **Causa**: los extractos de notificaciones se serializan en argumentos de proceso y el error del backend se registra sin retirar el contenido; en Linux el backend usa shell. El despachador con un lanzador simulado recibió un marcador en sus argumentos. Con **procesos sintéticos separados**, Windows permitió al mismo usuario leer un argumento mediante `Win32_Process.CommandLine`, y un contenedor Linux permitió a otro UID leerlo en `/proc/<pid>/cmdline`. En otra prueba Linux, el bundle real de entrega registró el marcador cuando un `notify-send` controlado falló; el control exitoso no lo registró. **Impacto**: exposición local según permisos y configuración del SO, y persistencia de fragmentos en logs ante ciertos fallos. No se probó lectura de los argumentos del despachador real por otro usuario ni inyección de comandos.
- **Corrección propuesta**: transportar datos sensibles sin argv y depurar errores antes de registrarlos (recomendada); verificar backend Linux con entorno aislado. **Decisión requerida**: Sí. **Prioridad**: P1.

#### S3-07 — Payloads completos en cola con permisos heredados

- **Categoría**: Seguridad. **Área/plataforma**: almacenamiento local.
- **Evidencia**: `src/voice/queue.ts:70-79,83-89`, `src/lib/state-dir.ts:39-43`, `src/lib/hook-payload.ts:9-27`, `SECURITY.md:31-38`.
- **Confianza**: Alta en contenido y ausencia de permisos explícitos; exposición depende de umask y ACL. **Causa**: se escribe el payload completo, incluidos campos adicionales, y los temporales no participan en la poda. Una prueba aislada confirmó que un campo sintético adicional se escribió en el JSON de cola. **Impacto**: exposición o retención local de contenido de sesión según el entorno y fallos; no se verificaron permisos efectivos en otros sistemas.
- **Corrección propuesta**: minimizar los campos persistidos y establecer política de permisos y limpieza de temporales (recomendada), validando Windows y POSIX. **Decisión requerida**: Sí. **Prioridad**: P1.

### S2 — Medios

#### S2-01 — Inicio de subagente atribuido al agente principal

- **Categoría**: Fiabilidad. **Área/plataforma**: transcript.
- **Evidencia**: `src/transcript/lifecycle.ts:116-132`, `src/transcript/lifecycle.test.ts:304-322`, `.claude-plugin/types/claude-code/index.d.ts:14500-14523` (tipos locales generados, no versionados).
- **Confianza**: Alta en el código y contrato local; falta observación en host. **Causa**: `onTurnStart` escribe siempre `MAIN`. Una prueba del kit, con eventos sintéticos separados por 1,2 s, observó que el inicio de un subagente cambia la hora del spinner principal. **Impacto**: hora del spinner o prompt principal potencialmente atribuida a un subagente; el host real puede emitir eventos en otro orden.
- **Corrección propuesta**: separar por `agentId` y cubrir eventos reales y sintéticos (recomendada). **Decisión requerida**: No. **Prioridad**: P2.

#### S2-02 — Promesa de carga del store no se recupera

- **Categoría**: Fiabilidad. **Área/plataforma**: transcript.
- **Evidencia**: `src/transcript/timing-store.ts:64-87,107-124`, `src/transcript/render.ts:201-209`.
- **Confianza**: Alta para el fallo simulado en el kit. **Causa**: un rechazo queda cacheado y el encadenamiento de persistencia no lo maneja. Al fallar la primera llamada a `store.keys`, tres renders provocaron un toast de apagado y el contador indicó un solo intento de carga, aunque el fondo simulado hubiera respondido en el siguiente intento. **Impacto**: fallos repetidos y apagado del transcript tras un error inicial; no se ha reproducido con un store real recuperado.
- **Corrección propuesta**: definir reintento y tratamiento de rechazos con pruebas del guard (recomendada). **Decisión requerida**: Sí. **Prioridad**: P2.

#### S2-03 — El worker silencia excepciones al salir

- **Categoría**: Observabilidad. **Área/plataforma**: voz.
- **Evidencia**: `src/voice/narrate-worker.ts:312-330`, `src/voice/queue.ts:119-131`.
- **Confianza**: Alta para el payload sintético ensayado. **Causa**: `process.exit(0)` en `finally` impide llegar al `catch` exterior. Con una respuesta numérica en la cola aislada, el worker salió con código cero, eliminó el ítem y no registró error; el control textual sí registró la ausencia del ejecutable. **Impacto**: errores y pérdidas de ítems pueden no quedar diagnosticados; no se ha probado que el host real envíe ese payload inválido.
- **Corrección propuesta**: liberar lock sin finalizar antes de registrar el fallo, conservando el contrato del hook (recomendada). **Decisión requerida**: No. **Prioridad**: P2.

#### S2-04 — Cola no garantiza FIFO entre procesos

- **Categoría**: Fiabilidad. **Área/plataforma**: voz.
- **Evidencia**: `src/voice/queue.ts:38-63,70-89`.
- **Confianza**: Alta para el escenario controlado; frecuencia no medida. **Causa**: contadores y reloj son por proceso y el orden de publicación puede diferir del de generación. Dos procesos con el mismo milisegundo publicaron primero el ítem del PID mayor y luego el del menor; la cola los listó en orden inverso. **Impacto**: inversión de eventos concurrentes pese al comentario de FIFO estricto.
- **Corrección propuesta**: definir el orden observable y coordinar publicación si se exige FIFO global (recomendada). **Decisión requerida**: Sí. **Prioridad**: P2.

#### S2-05 — Errores de SnoreToast pueden parecer éxito

- **Categoría**: Observabilidad. **Área/plataforma**: Windows.
- **Evidencia**: `node_modules/node-notifier/notifiers/toaster.js:74-100,131-151`, `dist/notification-deliver.js:3807`, `src/notifications/desktop-notification-adapter.ts:60-64`, `src/notifications/delivery.ts:143-146`.
- **Confianza**: Alta en la ruta de `WindowsToaster` ensayada. **Causa**: al invocarlo con una ruta de ejecutable inexistente, el intento de iniciar el proceso falló con `ENOENT` y la dependencia devolvió al callback `error=null`. **Impacto**: el adaptador puede interpretar el fallo como éxito y registrarlo así; no se observó el log completo de entrega en esta prueba ni se probaron otros códigos de salida de un binario existente.
- **Corrección propuesta**: reproducir y corregir o sustituir la ruta de backend con pruebas del fallo (recomendada). **Decisión requerida**: Sí. **Prioridad**: P2.

#### S2-06 — Formato de cadenas de accesos directos incorrecto

- **Categoría**: Compatibilidad. **Área/plataforma**: Windows.
- **Evidencia**: `src/notifications/lnk-format.ts:42-51,81-99`, `tests/desktop-notifications.spec.ts:372-405`; [MS-SHLLINK StringData](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-shllink/17b69472-0f34-4bcf-b290-eccdb8de224b) exige cadena sin terminador NUL.
- **Confianza**: Alta con un acceso directo real creado por `WScript.Shell`. **Causa**: se cuenta un NUL y el lector descarta siempre el último carácter. Un `.lnk` creado por Windows con `...shell32.dll,2` fue leído por `parseIconLocation` como `...shell32.dl`; tras `patchIconLocation`, el parser del plugin y `WScript.Shell` leyeron la cadena completa, aunque el archivo parcheado conserva el NUL extra contrario a la especificación. **Impacto**: lectura truncada de enlaces conformes antes de parchearlos; la tolerancia observada en `WScript.Shell` no garantiza otros consumidores ni el render visual del toast.
- **Corrección propuesta**: alinear parser y escritor con la especificación y probar fixtures conformes y enlaces reales (recomendada). **Decisión requerida**: Sí. **Prioridad**: P2.

#### S2-07 — Smoke previo no identifica el commit etiquetado

- **Categoría**: DevOps. **Área/plataforma**: release.
- **Evidencia**: `docs/RELEASING.md:38-42,84-87,118-126,279-294,488-506,527-532`.
- **Confianza**: Alta, reproducida con clon local. **Causa**: el clon de smoke precede al commit de release y puede reutilizar un directorio existente sin actualizarlo. Un cambio sin commit en el repositorio origen no apareció en el clon local (`origen=True`, `clon=False`). **Impacto**: el artefacto probado no queda necesariamente vinculado al commit etiquetado.
- **Corrección propuesta**: fijar y comprobar explícitamente el commit del smoke y del tag, tras definir el orden de release (recomendada). **Decisión requerida**: Sí. **Prioridad**: P2.

### S1 — Bajos

#### S1-01 — Reparación de mojibake puede dañar Unicode

- **Categoría**: Fiabilidad. **Área/plataforma**: notificaciones.
- **Evidencia**: `src/notifications/hook-payload-notification-message.ts:25-40`.
- **Confianza**: Alta, reproducida contra la función real. **Causa**: una firma localizada activa recodificación global. `Ã© 😀` se transformó en `é =\u0000`, mientras los controles `Ã©` y `😀` por separado conservaron el resultado esperado. **Impacto**: caracteres Unicode válidos pueden corromperse en el texto mostrado.
- **Corrección propuesta**: limitar la reparación y cubrir mezcla de mojibake y Unicode válido (recomendada). **Decisión requerida**: No. **Prioridad**: P2.

#### S1-02 — Gate de vendor y metadatos de release incompletos

- **Categoría**: DevOps y documentación. **Área/plataforma**: build y release.
- **Evidencia**: `build.mjs:162-194`, `docs/RELEASING.md:22-24,55-61,497-504`, `package-lock.json:2-9`.
- **Confianza**: Alta, reproducida en copia temporal. **Causa**: `check-dist` verifica presencia de vendor, no igualdad de contenido; el bump documentado omite la versión del lockfile. Tras añadir contenido sintético a `vendor/snoreToast/LICENSE`, `npm run check-dist` terminó en éxito. **Impacto**: desviaciones de vendor o metadatos pueden pasar inadvertidas; no se ha demostrado alteración en el repositorio actual.
- **Corrección propuesta**: alinear descripción y verificación, e incluir el lockfile en el procedimiento (recomendada). **Decisión requerida**: Sí. **Prioridad**: P2.

## Orden de corrección recomendado

1. **P1**: abordar los riesgos de privacidad y exclusión mutua de S3-01 a S3-07 antes de los cambios dependientes de la cola. Conservar los controles existentes y completar las pruebas de integración y regresión que exija cada solución.
2. **P2**: resolver S2-01 a S2-07 y S1-01 a S1-02 con pruebas de regresión y validación por plataforma.

## Confirmación en CI y límites

- Las pruebas anteriores al inicio de la auditoría registraron 367 pruebas generales y 42 de transcript aprobadas en Windows; no validan las intercalaciones enumeradas ni constituyen evidencia de CI remoto.
- CI declara Linux, Windows y macOS, pero parte de los tests simula plataformas o backends (`.circleci/config.yml:121-127,178-182,236-242`, `tests/desktop-notifications.spec.ts:409-416,454-480`). No se verificaron ejecuciones remotas durante esta auditoría.
- `npm audit --json` informó 13 nodos moderados, asociados a los advisories [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) y [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), en dependencias clasificadas de desarrollo. Son alertas de inventario, no 13 vulnerabilidades distintas. **Corrección**: la clasificación como dependencia de desarrollo no implica ausencia en distribución: `dist/notification-deliver.js:3406-3726` incluye `uuid`, incluidos `v3` y `v5`, pero la ruta de entrega usa `v4` para el nombre del pipe; no se demostró alcanzabilidad de la ruta vulnerable.
- Pendientes de corroboración: el caso `message.content` string no está respaldado por el contrato local, que declara un arreglo; tampoco está probado que `/clear` o `/compact` lo produzcan. La posible correlación incorrecta de varios bloques en `src/transcript/lifecycle.ts:400-409,432-458`, la terminación de procesos tras timeout y el comportamiento de shims Windows requieren experimentos antes de clasificarlos como defectos adicionales.
- Se comprobó al menos un mecanismo o condición de cada uno de los 16 hallazgos mediante controles aislados; no todos sus impactos se reprodujeron de extremo a extremo. Las carreras de locks y salida se forzaron y no se midió su frecuencia natural; tampoco se probaron sesiones interactivas de macOS ni un escritorio Linux real. No se puede garantizar ausencia de otros defectos.

## Evidencia de verificación posterior

Los detalles de cada entrada indican qué se observó directamente y qué queda condicionado a la plataforma o a una intercalación concreta. En el equipo de la auditoría se conservaron sondas y copias en `%LOCALAPPDATA%/Temp/opencode/evx-audit-verify-20261110` y `%LOCALAPPDATA%/Temp/opencode/evx-audit-final-20261110`; son rutas temporales locales, no parte de este repositorio. En particular, la prueba del kit está en `%LOCALAPPDATA%/Temp/opencode/evx-audit-verify-20261110/src/transcript/audit-probe.test.ts`; en el segundo directorio, `host-store-probe.py` contiene la sonda de reemplazo del store y `config-ui-probe.py` el control de configuración. Este último quedó configurado para el control con espera de seis segundos: su contenido actual no es una copia inmutable de la condición de reutilización inmediata del worker.

Los resultados documentados no sustituyen la verificación de una corrección: cada remediación debe incorporar pruebas de regresión adecuadas y, cuando corresponda, contrastarse con el host y la plataforma afectados. Las severidades y prioridades son recomendaciones revisables si aparece evidencia adicional sobre el impacto o las dependencias de corrección.
