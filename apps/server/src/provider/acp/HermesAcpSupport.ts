/**
 * HermesAcpSupport — spawn + auth-method wiring for the Hermes Agent ACP
 * runtime, the direct analog of `GrokAcpSupport` / the wiring half of
 * `CursorAcpSupport`.
 *
 * Drives `hermes acp` (standard ACP JSON-RPC over stdio) through the shared
 * `AcpSessionRuntime`. Hermes has no proprietary extension methods (no
 * `cursor/ask_question`, no `xai/...`), so this module is deliberately thin:
 * it only supplies the spawn input, the auth method id, and model-selection
 * helpers that build on the agent's standard `session/set_model`.
 *
 * @module provider/acp/HermesAcpSupport
 */
import { type HermesSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

type HermesAcpRuntimeHermesSettings = Pick<HermesSettings, "binaryPath" | "launchArgs">;

interface HermesAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly hermesSettings: HermesAcpRuntimeHermesSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

const HERMES_DRIVER_KIND = ProviderDriverKind.make("hermes");

/**
 * Auth method advertised by `hermes acp` that reuses the currently
 * configured runtime credentials for this machine (no interactive setup).
 * It is the non-terminal method Hermes advertises in initialize when a
 * provider is already configured. Falls back to `hermes-setup` would
 * require a TTY, which T3 cannot provide, so a configured install is a
 * precondition — mirroring how Codex/Claude require an authenticated CLI.
 */
const HERMES_AUTH_METHOD_RUNTIME = "opencode-go";

/**
 * Build the `AcpSpawnInput` that launches the Hermes Agent ACP server.
 * `hermes acp` reads `~/.hermes/.env` and the active profile itself, so
 * only `binaryPath`, the `acp` subcommand, and any user launchArgs are
 * passed here.
 */
export function buildHermesAcpSpawnInput(
  hermesSettings: HermesAcpRuntimeHermesSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  const binaryPath = hermesSettings?.binaryPath?.trim() || "hermes";
  const extraArgs = hermesSettings?.launchArgs?.trim()
    ? hermesSettings.launchArgs.trim().split(/\s+/)
    : [];
  return {
    command: binaryPath,
    args: [...extraArgs, "acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeHermesAcpRuntime = (
  input: HermesAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildHermesAcpSpawnInput(input.hermesSettings, input.cwd, input.environment),
        authMethodId: HERMES_AUTH_METHOD_RUNTIME,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

export function resolveHermesAcpBaseModelId(model: string | null | undefined): string {
  const base = model?.trim();
  return base && base.length > 0 ? normalizeModelSlug(base, HERMES_DRIVER_KIND) ?? base : "hermes";
}

export function currentHermesModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

export function applyHermesAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}