---
name: sync-with-engine
description: Synchronizes the plugin with the latest published release of the AI Voice-InterConnector engine (drift diagnosis, plan, execution and propagation across code, tests, comments and documentation). Sincroniza el plugin con el motor.
when_to_use: Invoke with /sync-with-engine [tag] or when the user asks to synchronize or update the plugin against the engine, ai-voice-interconnector, the minimum engine version, or to reinstall the engine (sincronizar, actualizar respecto al motor, versión mínima, reinstalar el motor). Only on demand.
argument-hint: "[tag]"
---

# Workflow: Sync with engine

<!-- <overview> -->

## Overview

The dependency is one-way: only the plugin changes. The engine (`../AI-Voice-InterConnector`) is the source of truth and is read from its **published tag**, never from `main`. Rule from `docs/RELEASING.md`: engine first, plugin after.

Support is exclusive: a single verified cut, which is also the minimum. It is declared in `package.json` (`engine.aiVoiceInterConnector`) and is the only machine-readable source of the number.
<!-- </overview> -->

<!-- <user_communication> -->

## User communication

All user-facing output is in **Spanish**, per `<language_policy>` in `.claude/skills/artifact-structuring/SKILL.md`. Code comments and commit messages are also Spanish (AGENTS.md §0).
<!-- </user_communication> -->

<!-- <inputs> -->

## Inputs

1. **Current cut**: `node -p "require('./package.json').engine.aiVoiceInterConnector"`.
2. **Target**: the `[tag]` argument or, if missing, the latest non-draft release from `gh release list --repo CristianRojas-SoftwareEngineer/AI-Voice-InterConnector --exclude-drafts --limit 1`. Validate with `gh release view <tag> --json assets` that it publishes `install.ps1`, `install.sh` and `SHA256SUMS.txt`.
3. **Engine clone**: `../AI-Voice-InterConnector`. Run `git -C ../AI-Voice-InterConnector fetch --tags` before comparing. Stop if the clone or the tag is missing.
4. **Preconditions** (verify; stop if any fails): `gh auth status` succeeds; the plugin tree is clean (`git status --short` empty) on `main` or a work branch.
5. **Already synchronized**: if current cut = target, report "sincronizado con v<corte>" and finish without mutating anything.

<!-- </inputs> -->

<!-- <drift_analysis> -->

## Drift analysis

Commands (read-only, `git show`/`diff`/`log` only):

- `git -C ../AI-Voice-InterConnector log --oneline v<cut>..<target>`
- `git -C ../AI-Voice-InterConnector diff --stat v<cut> <target> -- docs/CLI crates/avi-core/src/exit_codes.rs src/main.rs`, then the full diff of those paths (if the engine moved them, locate the CLI docs, exit codes and entry point first).
- The engine `CHANGELOG.md` section of each intermediate version via `git show <target>:CHANGELOG.md`.

Classify the jump into one of four levels:

| Level        | Criterion                                                     | Typical evidence                                                                                |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| no effect    | Only CI or the `VERSION` constant changed                     | Release diff touches only CI workflows and the `VERSION` constant                               |
| internal     | Implementation changed; no change in shape, exits or `reason` | Same CLI docs; code changes in probes or timings (review the plugin's budgets and timeouts)     |
| semantic     | Same shape, different meaning                                 | Same JSON keys, but a check, exit code or `reason` means something new (read the CLI docs diff) |
| incompatible | Incompatible shape, flags, exit codes or `reason`             | Removed or renamed flags, keys, exits or `reason` values in the CLI docs diff                   |

For _semantic_ and _incompatible_, delegate the diagnosis to the `investigate` skill (Level 1 invocation of `<sub_invocation_protocol>` in `artifact-structuring`: read its `SKILL.md` first and pass the full context).
<!-- </drift_analysis> -->

<!-- <consumption_map> -->

## Consumption map

| Engine surface                                                  | Plugin files                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `doctor --json`                                                 | `src/voice/health-decision.ts`, `src/voice/health-check.ts`, `tests/health-decision.spec.ts`, `tests/health-check.spec.ts`                                                                                                                                                                                                                                                                                                                                         |
| `daemon status --json` / `daemon start --warm-voice`            | `src/voice/daemon.ts`, `src/voice/health-check.ts`, `tests/daemon.spec.ts`, `tests/health-check.spec.ts`                                                                                                                                                                                                                                                                                                                                                           |
| `speech play` / `speech say --json`                             | `src/voice/narrate-worker.ts` (`REASON_HINTS`, `reasonHint`, `failureDetail`), `src/voice/voice-problem.ts` (`NOTIFIABLE_REASONS`), `src/narrate-ctl.ts` (`say --json`) with `src/voice/voice-errors.ts`, `src/voice/resolve-cli.ts` (`runCliWithTimeout`), `src/voice/say-timeout.ts` (calibrated against the engine RTF), `tests/narrate-worker.spec.ts`, `tests/run-cli.spec.ts`                                                                                |
| `--json` error envelope (`{error, reason}`) and `doctor` report | `parseSingleJsonObject` in `src/voice/health-decision.ts`, shared by `src/voice/health-check.ts` and `src/voice/narrate-worker.ts`: an envelope change hits both channels                                                                                                                                                                                                                                                                                          |
| `speech synthesize`                                             | `src/narrate-ctl.ts`, `src/voice/voice-errors.ts`, `tests/narrate-ctl.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                     |
| `--voice` (`speech play`, `speech say`, `speech synthesize`)    | `src/voice/narrate-worker.ts`, `src/narrate-ctl.ts`, `src/voice/queue.ts`, `tests/narrate-worker.spec.ts`, `tests/narrate-ctl.spec.ts`                                                                                                                                                                                                                                                                                                                             |
| `setup` / installers                                            | `commands/install.md`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `voice list` / `voice clone` / `voice remove`                   | `src/voice/voice.ts` (`parseVoiceList`, `FACTORY_VOICES`, `CUSTOM_VOICE`, `SELECTABLE_VOICES`, which must match `userConfig.voice.options` in `.claude-plugin/plugin.json`), `src/voice/voice-errors.ts` (`REASON_MESSAGES`), `src/narrate-ctl.ts`, `src/voice/health-check.ts` (`voice list`), `commands/voice.md`, `tests/voice.spec.ts`, `tests/voice-errors.spec.ts`, `tests/narrate-ctl.spec.ts`, `tests/health-check.spec.ts`, `docs/specs/VOICE_CLONING.md` |
| `version --json`                                                | `src/voice/voice.ts` (`MIN_ENGINE_VERSION`, `meetsMinVersion`), `src/narrate-ctl.ts` (`meetsEngineVersion`), `tests/voice.spec.ts`                                                                                                                                                                                                                                                                                                                                 |
| all                                                             | `docs/INTEGRATION.md`, `docs/RELEASING.md`                                                                                                                                                                                                                                                                                                                                                                                                                         |

Engine paths per surface: `docs/CLI/commands/{DOCTOR,DAEMON,SPEECH,SETUP,VOICE}.md` and `docs/CLI/CONTRACT.md` §1, §10 and §12. Use the code graph (`trace_path`) to measure the impact of changing a shared function.
<!-- </consumption_map> -->

<!-- <workflow> -->

## Workflow

1. **Inputs and diagnosis**: resolve `<inputs>` and run `<drift_analysis>`.
2. **Plan**: from level _internal_ upward, use `create-plan` (it invokes `resolve-open-decisions` when there are decisions). For _no effect_, a minimal propagation plan. **Pause 1**: the user approves the plan.
3. **Execution**: for _semantic_ and _incompatible_, failing tests first, then code, then documentation.
4. **Propagation**: see `<propagation>`.
5. **Verification**: `npm run typecheck`, `build`, `test`, `lint`, `format:check` and `check-dist`, in that order.
6. **Pause 2**: engine reinstall, see `<engine_reinstall>`.
7. **Pause 3**: commits with the `conventional-commits` skill, one per mutation task.
8. **Closure**: see `<closure>`.

<!-- </workflow> -->

<!-- <propagation> -->

## Propagation

Closed list of what carries the number:

- `package.json` (`engine.aiVoiceInterConnector`).
- `README.md` (link `blob/<tag>/docs/CLI/CONTRACT.md` and "verificado contra").
- `docs/INTEGRATION.md` (header link and tag, "Requisitos sobre el motor", "Estabilidad del contrato").
- `docs/specs/VOICE_CLONING.md` (every place that states the verified or minimum version, plus the header date; locate them with `git grep -n -F "<previous cut>" docs/specs/VOICE_CLONING.md`).
- `CHANGELOG.md` (the "Verificado contra" line).

`MIN_ENGINE_VERSION` (`src/voice/voice.ts`) is the floor of voice management, not the verified cut: change it only when the `voice *` surfaces the plugin consumes change, together with its tests and the minimum stated in `docs/specs/VOICE_CLONING.md`, `docs/INTEGRATION.md`, `README.md`, `CHANGELOG.md` and `commands/voice.md`.

Final sweep: `git grep -n -F "<previous cut without v>" -- ':!package-lock.json' ':!dist' ':!vendor'` must return nothing except the occurrences of that floor. Never introduce versions in comments of `src/` or `tests/`; fixtures use `ENGINE_VERSION` from `tests/helpers.ts`.
<!-- </propagation> -->

<!-- <engine_reinstall> -->

## Engine reinstall

Procedure: `docs/RELEASING.md` Phase 2, step 1, with the `install.ps1` of the target tag (`irm …/releases/download/<tag>/install.ps1 | iex`; `install.sh` on Linux/macOS). Do not copy the runbook here.

Checks:

- `ai-voice-interconnector version`.
- `doctor --json` with exit 0 and `failed []`.
- `daemon start` and `daemon status --json` until `warm`.
- `speech play --label voice-stop --json`; on `speech_not_found`, run `node dist/narrate-ctl.js presynth` and repeat.

Warn the user beforehand: the reinstall may start from zero (several GB of models; check `setup` in the target tag's CLI docs), may modify `PATH` (open terminals do not see it) and stops the daemon.
<!-- </engine_reinstall> -->

<!-- <constraints> -->

## Constraints

- Never mutate `../AI-Voice-InterConnector` (only `fetch`, `log`, `diff`, `show`).
- Never tag, publish or push without an explicit order.
- Never run `doctor --repair` or `cleanup`, and never touch engine pidfiles or data.
- Never create scripts or automation in the repo.
- The audible smoke test (the audible items of Phase 2 in `docs/RELEASING.md`) is recommended and recorded, but never claimed as executed without the user's confirmation.

<!-- </constraints> -->

<!-- <closure> -->

## Closure

Report in Spanish: the walkthrough (process followed and deviations) plus the final state: previous cut → new cut, jump level, files touched, verification and reinstall results, and pending items (manual smoke test).
<!-- </closure> -->
