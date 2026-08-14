// URL scheme for /run-test.
//
// Old scheme carried 8 params (detectionId/detection_id, technique_id,
// atomic_id, atomic_name, atomic_number, environment, targetHost, focus,
// step) — several of them redundant or duplicated in two casings. This is
// the single source of truth for the short replacement scheme; every
// outbound link to /run-test should go through `buildRunTestHref` so
// callers can't drift from what `parseRunTestParams` actually reads.
//
//   Old              New    Notes
//   ---------------  -----  -----------------------------------------------
//   detectionId /
//   detection_id     d      unifies the two casings (the snake_case one was
//                            silently ignored before)
//   technique_id     t
//   atomic_id        a      atomic UUID only — name/number now resolved via
//                            getAtomicTest(a)
//   atomic_name,
//   atomic_number    (removed)
//   environment      env
//   targetHost       host
//   focus            mode   kept — some entry points navigate with only
//                            this param and no id
//   step             (removed) — derived from d/t/mode + completion state

export type RunTestMode = "validation" | "coverage" | "telemetry";

export interface RunTestParams {
  d?: string;
  t?: string;
  a?: string;
  env?: "lab" | "dev" | "prod";
  host?: string;
  mode?: RunTestMode;
}

const VALID_ENVS = new Set(["lab", "dev", "prod"]);
const VALID_MODES = new Set(["validation", "coverage", "telemetry"]);

export function parseRunTestParams(searchParams: URLSearchParams): RunTestParams {
  const d = searchParams.get("d")?.trim() || undefined;
  const t = searchParams.get("t")?.trim() || undefined;
  const a = searchParams.get("a")?.trim() || undefined;

  const envRaw = searchParams.get("env");
  const env = envRaw && VALID_ENVS.has(envRaw) ? (envRaw as RunTestParams["env"]) : undefined;

  const host = searchParams.get("host")?.trim() || undefined;

  const modeRaw = searchParams.get("mode");
  const mode = modeRaw && VALID_MODES.has(modeRaw) ? (modeRaw as RunTestMode) : undefined;

  return { d, t, a, env, host, mode };
}

export function buildRunTestHref(params: RunTestParams): string {
  const sp = new URLSearchParams();
  if (params.d) sp.set("d", params.d);
  if (params.t) sp.set("t", params.t);
  if (params.a) sp.set("a", params.a);
  if (params.env) sp.set("env", params.env);
  if (params.host) sp.set("host", params.host);
  if (params.mode) sp.set("mode", params.mode);
  const qs = sp.toString();
  return qs ? `/run-test?${qs}` : "/run-test";
}
