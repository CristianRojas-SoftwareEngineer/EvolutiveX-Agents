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
- `git -C ../AI-Voice-InterConnector diff --stat v<cut> <target> -- docs/CLI crates/avi-core/src/exit_codes.rs src/main.rs`, then the full diff of those paths.
- The engine `CHANGELOG.md` section of each intermediate version via `git show <target>:CHANGELOG.md`.

Classify the jump into one of four levels:

| Level        | Criterion                                                     | Real example                                                        |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| no effect    | Only CI or the `VERSION` constant changed                     | v0.41.2, v0.41.4                                                    |
| internal     | Implementation changed; no change in shape, exits or `reason` | v0.41.3 (review the plugin's budgets and timeouts)                  |
| semantic     | Same shape, different meaning                                 | v0.41.1 (integral `doctor`, `reason` on exit 3, anonymous download) |
| incompatible | Incompatible shape, flags, exit codes or `reason`             | —                                                                   |

For _semantic_ and _incompatible_, delegate the diagnosis to the `investigate` skill (Level 1 invocation of `<sub_invocation_protocol>` in `artifact-structuring`: read its `SKILL.md` first and pass the full context).
<!-- </drift_analysis> -->

<!-- <consumption_map> -->

## Consumption map

| Engine surface                                                  | Plugin files                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `doctor --json`                                                 | `src/lib/health-decision.ts`, `src/health-check.ts`, `tests/health-decision.test.ts`, `tests/health-check.test.ts`                                                 |
| `daemon status --json` / `daemon start`                         | `src/lib/daemon.ts`, `tests/daemon.test.ts`                                                                                                                        |
| `speech play` / `speech say --json`                             | `src/narrate-worker.ts` (`REASON_HINTS`, `failureDetail`), `src/lib/resolve-cli.ts` (`runCliWithTimeout`), `tests/narrate-worker.test.ts`, `tests/run-cli.test.ts` |
| `--json` error envelope (`{error, reason}`) and `doctor` report | `parseSingleJsonObject` in `src/lib/health-decision.ts`, shared by `src/health-check.ts` and `src/narrate-worker.ts`: an envelope change hits both channels        |
| `speech synthesize`                                             | `src/narrate-ctl.ts`, `tests/narrate-ctl.test.ts`                                                                                                                  |
| `setup` / installers                                            | `commands/install.md`                                                                                                                                              |
| `voice *`                                                       | `docs/specs/VOICE_CLONING.md`                                                                                                                                      |
| all                                                             | `docs/INTEGRATION.md`, `docs/RELEASING.md`                                                                                                                         |

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
- `docs/specs/VOICE_CLONING.md` (header with date, minimum in the opening paragraph, D-15, §7.10, case 19, AC-27).
- `CHANGELOG.md` (the "Verificado contra" line).

Final sweep: `git grep -n -F "<previous cut without v>" -- ':!package-lock.json' ':!dist' ':!vendor'` must return nothing except this skill's own classification examples. Never introduce versions in comments of `src/` or `tests/`; fixtures use `ENGINE_VERSION` from `tests/helpers.ts`.
<!-- </propagation> -->

<!-- <engine_reinstall> -->

## Engine reinstall

Procedure: `docs/RELEASING.md` Phase 2, step 1, with the `install.ps1` of the target tag (`irm …/releases/download/<tag>/install.ps1 | iex`; `install.sh` on Linux/macOS). Do not copy the runbook here.

Checks:

- `ai-voice-interconnector version`.
- `doctor --json` with exit 0 and `failed []`.
- `daemon start` and `daemon status --json` until `warm`.
- `speech play --label voice-stop --json`; on `speech_not_found`, run `node dist/narrate-ctl.js presynth` and repeat.

Warn the user beforehand: the reinstall may start from zero (up to 5.9 GB of models), may modify `PATH` (open terminals do not see it) and stops the daemon.
<!-- </engine_reinstall> -->

<!-- <constraints> -->

## Constraints

- Never mutate `../AI-Voice-InterConnector` (only `fetch`, `log`, `diff`, `show`).
- Never tag, publish or push without an explicit order.
- Never run `doctor --repair` or `cleanup`, and never touch engine pidfiles or data.
- Never create scripts or automation in the repo.
- The audible smoke test (Phase 2, items A–F of `docs/RELEASING.md`) is recommended and recorded, but never claimed as executed without the user's confirmation.

<!-- </constraints> -->

<!-- <closure> -->

## Closure

Report in Spanish: the walkthrough (process followed and deviations) plus the final state: previous cut → new cut, jump level, files touched, verification and reinstall results, and pending items (manual smoke test).
<!-- </closure> -->
