# Proceso de release

Cómo se corta y publica una versión de **EvolutiveX Agents**. El proceso es deliberadamente más simple que el del motor ([AI-Voice-InterConnector/docs/RELEASING.md](https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/main/docs/RELEASING.md)): aquí no hay CI de publicación ni artefactos binarios por plataforma — el plugin se distribuye clonando el repo con `dist/` y `vendor/` commiteados, y **el release es un tag de git precedido por este checklist**. El CI de CircleCI corre en cada push como verificación continua (no participa del corte); el marketplace de plugins de Claude Code resuelve las versiones desde los tags del repo.

## Tabla de contenidos

- [Modelo de versionado](#modelo-de-versionado)
- [Prerequisitos del corte](#prerequisitos-del-corte)
- [Checklist de release](#checklist-de-release)
- [Sincronización con un release del motor](#sincronización-con-un-release-del-motor)
- [Después del tag](#después-del-tag)
- [Runbook ejecutable](#runbook-ejecutable)
  - [Convenciones y variables](#convenciones-y-variables)
  - [Fase 1 — Verificar que el motor publicado es el correcto](#fase-1--verificar-que-el-motor-publicado-es-el-correcto)
  - [Fase 2 — Smoke test contra el motor publicado](#fase-2--smoke-test-contra-el-motor-publicado)
  - [Fase 3 — Cortar el release del plugin](#fase-3--cortar-el-release-del-plugin)
  - [Fase 4 — Verificación posterior al corte](#fase-4--verificación-posterior-al-corte)

## Modelo de versionado

- Versionado Semántico, tags `vX.Y.Z`.
- La versión vive en **dos archivos que deben coincidir siempre**:
  `package.json` y `.claude-plugin/plugin.json`. Un release con los dos números
  distintos es un release inválido.
- El versionado es **independiente del motor**: cada proyecto numera según su
  propia historia, y lo que se sincroniza entre ambos es el lanzamiento, no el
  número. Durante el tramo pre-1.0 el plugin publica sus versiones intermedias
  a su propio ritmo. Cuando AI Voice-InterConnector alcance su `v1.0.0`, el
  plugin avanzará desde la versión que haya alcanzado directamente a `1.0.0`,
  en un release que acumule las correcciones implementadas hasta entonces; ese
  salto es intencional, no un error de versionado.
- La versión del motor verificada vive en `package.json`
  (`engine.aiVoiceInterConnector`): soporte exclusivo a ese único corte, que es
  a la vez el mínimo.

## Prerequisitos del corte

Antes de empezar el checklist, en `main` debe estar todo en verde:

1. El pipeline de CircleCI (cuarta puerta `validate-manifest` y triple puerta
   `test-linux`/`test-windows`/`test-macos`) en verde sobre el commit candidato.
2. Ningún cambio pendiente en el árbol (`git status` limpio).

## Checklist de release

En orden; cada paso asume el anterior.

1. **Bump de versión doble**: actualizar `version` en `package.json` **y** en
   `.claude-plugin/plugin.json` al mismo `X.Y.Z`.
2. **Cortar la sección del changelog**: en `CHANGELOG.md`, renombrar
   `## [No publicado]` a `## [X.Y.Z] — AAAA-MM-DD` y dejar la entrada lista
   (incluida la versión del motor contra la que se verificó, ver la sección
   de sincronización). Crear una nueva sección `## [No publicado]` vacía encima
   y actualizar las referencias de enlaces del pie.
3. **Verificar `dist/` y `vendor/`** (el pre-commit hook los regenera automáticamente al commitear):
   ```bash
   npm run check-dist
   npm run typecheck
   npm test
   ```
   `check-dist` en verde es obligatorio: lo que ejecutan los usuarios es el `dist/` y `vendor/` del árbol de git.
   El hook en `.githooks/pre-commit` corre `npm run build` y staggea `dist/` y `vendor/` en cada commit, así que no
   hace falta invocarlo manualmente.
   La identidad pública del plugin se verifica aparte, con el mismo gate que el CI
   (job `validate-manifest`):
   ```bash
   claude plugin validate --strict .
   ```
   Este paso es el que detecta un `name` de plugin que Anthropic reserva (p. ej. el
   prefijo `claude-`) o que no es kebab-case, requisitos del marketplace de Claude.ai
   que el resto del checklist no mira.
4. **Verificar la versión del motor declarada**: `engine.aiVoiceInterConnector`
   de `package.json` coincide con la declarada en `README.md` (línea
   «Contraparte del motor»), en [`docs/INTEGRATION.md`](INTEGRATION.md)
   («Requisitos sobre el motor») y en la entrada de `CHANGELOG.md`, y es la que
   se usó en el smoke test del paso 6.
5. **Verificar referencias cruzadas en ambos repos**: el motor referencia al
   plugin en `docs/CLI/CONTRACT.md` (§12 «Contratos externos» del tag
   verificado) y su diseño en `docs/DESIGN.md` (del repo del motor);
   el plugin referencia al motor en `docs/INTEGRATION.md` y el README. Ambos
   lados deben apuntar a las versiones etiquetadas (o al menos no
   contradecirlas). Esta verificación vive aquí y no en el checklist del
   motor, porque el checklist del motor no conoce al plugin.
6. **Smoke test manual desde un clon limpio**: clonar el repo en un directorio
   nuevo (no usar el árbol de desarrollo), cargar el plugin en una sesión real
   de Claude Code y verificar, con el motor **instalado desde sus artefactos
   publicados** (no desde su árbol de desarrollo):
   - narración de **todas** las superficies del contrato de voz (los cinco hooks
     de voz registrados en `hooks/hooks.json`: `UserPromptSubmit`, `Stop`,
     `SubagentStop`, `StopFailure` y `Notification`) en modo `local` (sin
     clave) y con `Stop` en modo `llm` (con `GEMINI_API_KEY` definida); no
     basta con `Stop` — una superficie no probada puede liberarse con un bug;
   - emisión de toasts silenciosos del canal de notificaciones de escritorio
     (`dist/notification-hook.js`), funcionamiento de los toggles `notifications-on` /
     `notifications-off` y registro idempotente del AUMID en Windows
     (`dist/notification-register.js --install` y `--status`);
   - `narrate-ctl status` reporta el estado (`voice` y `notifications`) sin exponer claves;
   - el aviso de `SessionStart` cuando el motor no está en el `PATH`;
   - el aviso no bloqueante de `SessionStart` con un check de instalación
     fallido, con el daemon arrancado igual (Fase 2, ítem E);
   - la causa por `reason` en `worker.log` ante un `speech play` fallido
     (Fase 2, ítem F).
7. **Commit, tag y push**:
   ```bash
   git commit -m "release: vX.Y.Z"
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```
   El tag es el punto de no retorno: el marketplace de plugins resuelve la
   versión desde los tags del repo, así que a partir del push del tag los
   usuarios pueden instalar exactamente ese estado.

## Sincronización con un release del motor

El procedimiento está codificado en la skill de desarrollo `/sync-with-engine [tag]` (`.claude/skills/sync-with-engine/SKILL.md`), que lee el corte de `package.json`, lo compara con el último tag publicado del motor y aplica esta sección.

Cuando el release del plugin acompaña a un release del motor, el orden importa — **primero el motor, después el plugin**:

1. El motor corta su tag; su pipeline de CircleCI construye y publica los
   artefactos (binarios nativos por plataforma) automáticamente.
2. Se instala el motor **desde los artefactos publicados** (instalador nativo
   por SO), no desde `main` del motor, y se corre el
   smoke test del paso 6 contra esa instalación. Esto garantiza que lo que el
   plugin declara compatible es lo que un usuario real puede instalar, no un
   estado intermedio del árbol del motor.
3. Recién entonces se corta el tag del plugin, con la versión del motor
   verificada declarada en `package.json` y propagada a README,
   `docs/INTEGRATION.md`, la spec y la entrada del `CHANGELOG.md`.

Si el release del plugin **no** acompaña a uno del motor (una corrección propia), basta el checklist normal: el smoke test se corre contra la última versión publicada del motor, que sigue siendo la declarada como mínima.

## Después del tag

- Verificar que `/plugin marketplace add` + `/plugin install` resuelven la
  versión nueva en una máquina limpia.
- Si la entrada del changelog del motor menciona la disponibilidad del plugin,
  confirmar que el enlace apunta al tag correcto.
- Actualizar [`ROADMAP.md`](ROADMAP.md): las direcciones ya implementadas o
  descartadas se retiran del documento (el historial queda en git); las nuevas
  que surjan del release se incorporan a la sección correspondiente.

## Runbook ejecutable

Aplicación práctica del [Checklist de release](#checklist-de-release) de arriba: en lugar de pasos genéricos, cada fase lista los **comandos concretos** (PowerShell 7 sobre Windows 11) y la **comprobación** de cada paso.

Las fases asumen que el release del plugin **acompaña** a uno del motor. Si es un release correctivo propio (sin nuevo release del motor), las fases 1 y 2 se saltan — el smoke test se corre contra la versión del motor ya declarada como mínima.

### Convenciones y variables

Estas variables se reutilizan en varias fases; defínelas al inicio de la sesión de PowerShell. El primero en hacer el release las ajusta a su entorno:

```powershell
# Árbol de desarrollo del plugin.
$PLUGIN_DEV = (Get-Item .).FullName

# Directorio temporal para el clon limpio del E2E.
$PLUGIN_E2E = "$env:TEMP\evolutivex-agents-e2e"

# State dir del plugin (Windows): %LOCALAPPDATA%\evolutivex-agents.
$STATE_DIR = "$env:LOCALAPPDATA\evolutivex-agents"

# Versión del motor verificada (fuente única: package.json).
$MOTOR_VERSION = "v" + (Get-Content "$PLUGIN_DEV\package.json" | ConvertFrom-Json).engine.aiVoiceInterConnector

# (Opcional) Árbol del repo del motor, para las comprobaciones cruzadas.
$ENGINE_ROOT = "C:\ruta\a\AI-Voice-InterConnector"

# Atajo para invocar la CLI de control compilada.
function narrate-ctl { node "$PLUGIN_E2E\dist\narrate-ctl.js" @args }
```

Notas de contrato que el runbook asume (verificado en código fuente):

- `narrate-ctl status` **no** reporta el daemon; el estado del daemon se consulta
  con `ai-voice-interconnector daemon status --json`.
- `narrate-ctl status` **nunca** imprime el valor de ninguna clave: solo muestra
  `gemini key:   configurada|ausente`.
- `narrate-ctl say` pasa el texto directo a `ai-voice-interconnector speech say --text ... --daemon`
  (pipeline TTS + daemon); **no** ejercita la generación de mensaje (`local`/`llm`).
- `worker.log` (en `$STATE_DIR`) registra **solo errores** de narración, no qué
  proveedor se usó; la distinción `local` vs `llm` se verifica **por audible**.
  El CI verifica en cada push que `dist/` es la compilación de `src/`
  (`npm run check-dist`), no solo en el pre-commit.
- **Versión instalada vs. `$MOTOR_VERSION`**: `ai-voice-interconnector version`
  imprime la versión del motor con o sin el prefijo `v`; contrasta quitando
  **solo** ese prefijo a ambos lados antes de comparar (Fase 2, paso 1b):

  ```powershell
  $reportada = ((ai-voice-interconnector version).Trim() -split '\s+')[-1] -replace '^v', ''
  $esperada  = $MOTOR_VERSION -replace '^v', ''
  if ($reportada -ne $esperada) {
    throw "Motor instalado $reportada, se esperaba $esperada ($MOTOR_VERSION)."
  }
  ```

### Fase 1 — Verificar que el motor publicado es el correcto

El plugin se verifica contra la **última versión publicada del motor**, no contra su árbol de desarrollo (regla «primero el motor, después el plugin»). Esta fase confirma que el release del motor ya está disponible públicamente.

```powershell
# 1a. El GitHub Release expone los assets esperados (los binarios por
#     plataforma + SHA256SUMS.txt).
gh release view $MOTOR_VERSION --repo CristianRojas-SoftwareEngineer/AI-Voice-InterConnector

# Comprobación: la versión $MOTOR_VERSION figura como la más reciente
# en GitHub Releases, con sus artefactos por plataforma publicados.
```

### Fase 2 — Smoke test contra el motor publicado

Corresponde al paso 6 del [Checklist de release](#checklist-de-release). Es un **E2E audible en Windows 11 (PowerShell 7)**: quien corta el release lo ejecuta personalmente.

#### Paso 1 — Instalar y aprovisionar el motor publicado

```powershell
# 1a. Instalar el motor con el instalador publicado en la release
#     $MOTOR_VERSION (asset install.ps1 para Windows; install.sh es el de
#     Linux/macOS). Encadena setup automáticamente. Antes de descargar,
#     comprueba que el asset existe en esa release.
$release = gh release view $MOTOR_VERSION --repo CristianRojas-SoftwareEngineer/AI-Voice-InterConnector --json assets | ConvertFrom-Json
if ('install.ps1' -notin @($release.assets.name)) {
  throw "La release $MOTOR_VERSION no publica el asset install.ps1."
}
irm "https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/releases/download/$MOTOR_VERSION/install.ps1" | iex

# 1b. Comprobación: el CLI reporta la versión correcta.
ai-voice-interconnector version

# 1c. Aprovisionar los modelos (idempotente; el instalador ya lo encadena).
#     La descarga es anónima: ignora HF_TOKEN. Un model_unavailable (exit 1)
#     no se resuelve reintentando; un network_error (exit 20) sí.
ai-voice-interconnector setup

# 1d. Comprobación: doctor sano = exit 0 con failed vacío. El reporte es un
#     único objeto JSON y no tiene campo "status": un veredicto negativo sale
#     con exit 1 y failed no vacío (mismo reporte).
$doctor = ai-voice-interconnector doctor --json | ConvertFrom-Json
$ok = ($LASTEXITCODE -eq 0 -and @($doctor.failed).Count -eq 0)
$ok
#     Debe imprimir: True
if (-not $ok) { throw "doctor no está sano (failed: $($doctor.failed -join ', '))." }
```

#### Paso 2 — Dejar el daemon en marcha

```powershell
ai-voice-interconnector daemon start
# Comprobación: el daemon queda running. La clave es la cadena "daemon"; no
# existe el booleano "running". Nota: daemon status sale 0 en el caso normal;
# 1 (`daemon_error`) o 5 (`daemon_unreachable`) si el sondeo de salud falla.
# Un "stopped" o "degraded" con exit 0 es un estado válido, no un error.
ai-voice-interconnector daemon status --json | ConvertFrom-Json | ForEach-Object { $_.daemon -eq "running" }
#     Debe imprimir: True
```

#### Paso 3 — Clonar el plugin en un directorio limpio

No uses el árbol de desarrollo para el E2E: clona una copia fresca. Este smoke
se ejecuta **antes de publicar** el release del plugin, así que el clon sale de
la **ruta local** del repositorio de desarrollo (`$PLUGIN_DEV`): en ese momento
los cambios **aún no están en GitHub** y un clon remoto no los contendría. El
clon desde GitHub
(`git clone https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents`)
corresponde al smoke de una **release ya publicada**, no a éste.

```powershell
if (-not (Test-Path $PLUGIN_E2E)) {
  # Smoke previo a publicar: clon local, porque los cambios aún no están en GitHub.
  # Para el smoke de una release ya publicada, clona en su lugar desde GitHub:
  #   git clone https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents $PLUGIN_E2E
  git clone "$PLUGIN_DEV" $PLUGIN_E2E
}
# Comprobación: el dist/ compilado existe (es lo que ejecutan los hooks).
Test-Path "$PLUGIN_E2E\dist\narrate-ctl.js"
Test-Path "$PLUGIN_E2E\dist\notification-hook.js"
```

#### Paso 4 — Comprobación base (sin sesión de Claude)

Valida el pipeline TTS + daemon y el canal de notificaciones de escritorio de forma aislada. No requiere claves.

```powershell
narrate-ctl voice-on                  # activa la narración por voz
narrate-ctl notifications-on          # activa las notificaciones de escritorio
narrate-ctl mode local                # modo local (determinista, offline)
narrate-ctl status                    # voice: true, notifications: true, messageMode: local
node "$PLUGIN_E2E\dist\notification-register.js" --install
node "$PLUGIN_E2E\dist\notification-register.js" --status
node "$PLUGIN_E2E\dist\notification-cli.js" --event-type SessionStart --message "Prueba visual E2E" --silent
# La clave es la cadena "daemon"; "stopped" con exit 0 no es error; un exit 1/5 sí lo es: el sondeo falló (ver paso 2).
ai-voice-interconnector daemon status --json | ConvertFrom-Json | ForEach-Object { $_.daemon -eq "running" }
narrate-ctl say "Prueba de audio local"
# Comprobación AUDIBLE y VISUAL: se escucha la frase en español y aparece el toast con branding EvolutiveX Agents.
```

#### Paso 5 — Verificación completa por superficie del contrato (audible y visual)

Cada ítem deja el entorno en la condición indicada, dispara la narración y los toasts de escritorio, y **escucha y observa** el resultado. El plugin registra **cinco hooks de narración** (vía `dist/narrate-hook.js`) y **doce perfiles de notificación de escritorio** (vía `dist/notification-hook.js`, ver `hooks/hooks.json`). En voz, solo `Stop` cambia entre modos (única ruta dinámica que enruta al LLM); las otras cuatro superficies reproducen siempre su aviso pre-sintetizado, en `local` y en `llm` por igual. El smoke test debe ejercitar **las cinco superficies de voz** en modo `local`, confirmar los toasts visuales silenciosos y, en `llm`, verificar que `Stop` se oye distinto (parafraseado) y que el resto suena idéntico a `local`.

```powershell
# Lanzar Claude Code con el plugin del clon limpio (se abre por ítem).
claude --plugin-dir $PLUGIN_E2E
```

- **(A) Las cinco superficies en modo `local` (sin claves):**
  1. Antes de `claude`, sin claves definidas:
     ```powershell
     narrate-ctl mode local
     narrate-ctl status
     ```
  2. En la sesión de Claude, dispara **cada una** de las cinco superficies y
     confirma **por audible** que suena una locución en español, con el texto
     **limpio** (sin markdown, sin bloques de código ni URLs):
     - **`UserPromptSubmit`** — envía un prompt simple.
     - **`Stop`** — el asistente termina su turno. En modo `local` el texto ya
       **no** es casi textual: es la lectura de las **dos primeras oraciones**
       de la prosa del turno, con el cuerpo de los bloques de código descartado.
       No debe sonar código.
     - **`SubagentStop`** — lanza un subagente que concluya.
     - **`StopFailure`** — fuerza un fallo de turno.
     - **`Notification`** — deja una petición de permiso en espera.
  3. **Comprobación:** para las cuatro superficies de anuncio fijo, el texto
     narrado es limpio y casi textual; para `Stop` en modo `local`, son las dos
     primeras oraciones en prosa.

- **(B) Las superficies clave en modo `llm` (con `GEMINI_API_KEY`):**
  1. Define la clave en el entorno de la sesión de PowerShell:
     ```powershell
     $env:GEMINI_API_KEY = "<tu-clave-gemini>"
     ```
  2. Fija el modo:
     ```powershell
     narrate-ctl mode llm
     narrate-ctl status        # gemini key: configurada
     ```
  3. Lanza Claude desde esa misma sesión y dispara **`Stop`** — es la única
     superficie que enruta al LLM.
  4. **Comprobación:** la locución de `Stop` suena **parafraseada** (Gemini),
     distinta del resumen local determinista. `UserPromptSubmit`,
     `SubagentStop`, `StopFailure` y `Notification` no tienen paráfrasis que
     verificar: siempre reproducen su aviso pre-sintetizado, sin LLM, igual que en
     modo `local`.
  5. Diagnóstico:
     ```powershell
     Get-Content "$STATE_DIR\worker.log" -Tail 30
     ```

- **(C) `narrate-ctl status` no expone claves:**

  ```powershell
  $env:GEMINI_API_KEY = "<tu-clave-gemini>"
  narrate-ctl status        # muestra "configurada", NO el valor
  Remove-Item Env:\GEMINI_API_KEY
  narrate-ctl status        # muestra "ausente"
  ```

- **(D) Aviso de `SessionStart` sin motor en el `PATH`:**
  1. Quita el directorio del binario del `PATH` para la sesión:
     ```powershell
     $env:PATH = ($env:PATH -split ';' | Where-Object {
       $_ -and ($_ -notmatch 'ai-voice-interconnector') } ) -join ';'
     ```
  2. Abre Claude desde esa sesión. Debe aparecer el aviso **sin bloquear** la
     sesión.
  3. Restaura el `PATH`:
     ```powershell
     $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") +
                 ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
     ```

- **(E) Aviso no bloqueante de `SessionStart` con un check de instalación
  fallido:** una copia no registrada de la instalación (canal `unmanaged`)
  antepuesta en el `PATH` hace fallar `install_receipt` y/o `path_*` sin tocar
  los recursos. Se usan solo comandos oficiales del motor; no se tocan pidfiles
  ni datos.

  ```powershell
  ai-voice-interconnector daemon stop
  $installDir = (ai-voice-interconnector doctor --json | ConvertFrom-Json).install.dir
  $copy = Join-Path $env:TEMP "avi-unmanaged"
  Copy-Item -Recurse -Force $installDir $copy   # directorio completo: incluye la librería ONNX Runtime
  $env:PATH = "$copy;$env:PATH"
  ai-voice-interconnector doctor --json | ConvertFrom-Json | Select-Object -ExpandProperty failed
  # Debe listar solo install_receipt y/o path_* (nunca models_provisioned ni onnx_runtime).
  claude --plugin-dir $PLUGIN_E2E
  # Comprobación: aparece el aviso de chequeos de instalación SIN bloquear la sesión y,
  # tras unos segundos, `ai-voice-interconnector daemon status --json` informa "running".
  ai-voice-interconnector daemon stop
  $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("PATH","User")
  Remove-Item -Recurse -Force $copy
  ai-voice-interconnector daemon start
  ```

- **(F) Pista por `reason` en `worker.log`:** el label exacto del acuse se toma
  de la salida de `presynth` del runbook (forma `voice-user-prompt-submit`).

  ```powershell
  ai-voice-interconnector speech play --label etiqueta-inexistente --json
  # Exit 3 y {"error": ..., "reason": "speech_not_found"} en stdout.
  ai-voice-interconnector speech remove --label voice-user-prompt-submit
  # En una sesión de Claude, envía un prompt (UserPromptSubmit no suena).
  Get-Content "$STATE_DIR\worker.log" -Tail 5
  # Debe contener: speech play salió con código 3 (speech_not_found: ... narrate-ctl presynth)
  narrate-ctl presynth   # restaura el anuncio
  ```

Esta fase requiere verificación humana (audible) y no se automatiza por completo.

### Fase 3 — Cortar el release del plugin

Confirmado el smoke test de la Fase 2, se ejecuta el [Checklist de release](#checklist-de-release) completo. Se corre en el **árbol de desarrollo**.

```powershell
# 1. Confirmar la versión del motor declarada en package.json, README, INTEGRATION.md y CHANGELOG.md.
Select-String -Path "$PLUGIN_DEV\package.json","$PLUGIN_DEV\README.md","$PLUGIN_DEV\docs\INTEGRATION.md","$PLUGIN_DEV\CHANGELOG.md" `
  -Pattern ($MOTOR_VERSION -replace '^v','')

# 2. Bump de versión doble a X.Y.Z en package.json y .claude-plugin/plugin.json.
$V = Read-Host "Versión del plugin (ej. 0.2.0)"
(Get-Content "$PLUGIN_DEV\package.json") `
  -replace '(?<="version":\s*")[^"]+', $V | Set-Content "$PLUGIN_DEV\package.json"
(Get-Content "$PLUGIN_DEV\.claude-plugin\plugin.json") `
  -replace '(?<="version":\s*")[^"]+', $V | Set-Content "$PLUGIN_DEV\.claude-plugin\plugin.json"
Select-String -Path "$PLUGIN_DEV\package.json","$PLUGIN_DEV\.claude-plugin\plugin.json" `
  -Pattern '"version"'

# 3. Cortar el changelog: editar CHANGELOG.md manualmente.

# 4. Verificar dist/ y la identidad publica del plugin.
Push-Location $PLUGIN_DEV
npm run check-dist
npm run typecheck
npm test
# Mismo gate que el job validate-manifest del CI: rechaza los nombres de plugin
# reservados por Anthropic y los que no son kebab-case.
claude plugin validate --strict .
Pop-Location

# 5. Verificar referencias cruzadas con el motor.
Select-String -Path "$PLUGIN_DEV\README.md","$PLUGIN_DEV\docs\INTEGRATION.md" `
  -Pattern $MOTOR_VERSION
# Lado del motor (si está clonado en $ENGINE_ROOT con checkout del tag $MOTOR_VERSION):
#   Select-String -Path "$ENGINE_ROOT\docs\CLI\CONTRACT.md" -Pattern '^## 12\.' -Context 0,50
#   (§12 Contratos externos — sección El integrador de narración: la tabla de
#   superficies del motor que consume el plugin; en GitHub, la misma sección vive en
#   https://github.com/CristianRojas-SoftwareEngineer/AI-Voice-InterConnector/blob/$MOTOR_VERSION/docs/CLI/CONTRACT.md#12-contratos-externos)

# 6. Commit, tag y push.
Push-Location $PLUGIN_DEV
git add -A
git commit -m "release: v$V"
git tag "v$V"
git push origin main "v$V"
Pop-Location
git tag --list "v$V"
git ls-remote --tags origin "v$V"
```

### Fase 4 — Verificación posterior al corte

```powershell
# 1. Resolución desde una máquina limpia.
#    Comandos dentro de Claude Code:
#      /plugin marketplace add CristianRojas-SoftwareEngineer/EvolutiveX-Agents
#      /plugin install evolutivex-agents@EvolutiveX-Agents

# Comprobación: el tag está publicado.
git ls-remote --tags https://github.com/CristianRojas-SoftwareEngineer/EvolutiveX-Agents "v$V"

# 2. Si el changelog del motor menciona el plugin, confirmar que el enlace
#    apunta al tag correcto.
Select-String -Path "$ENGINE_ROOT\CHANGELOG.md" -Pattern "Agent[ -]Voice-InterConnector"

# 3. Actualizar ROADMAP.md: retirar las direcciones cerradas y añadir las que
#    surjan de este release.
```
