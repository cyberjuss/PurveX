export default function HowItWorksPage() {
  return (
    <div className="relative isolate w-full min-h-[calc(100vh-160px)] bg-slate-50/60">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_38%),radial-gradient(circle_at_80%_10%,rgba(14,165,233,0.08),transparent_32%)]" />
      <div className="relative w-full max-w-6xl min-w-0 mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14 space-y-8">
        <header className="space-y-3">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <span className="h-[1px] w-6 bg-slate-300" aria-hidden />
            Legal
          </p>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900">How PurveX works</h1>
            <p className="text-base text-slate-700 max-w-3xl">
              PurveX orchestrates scoped validation runs, captures telemetry context, and reports results without ever
              auto-executing payloads on your behalf. You stay in control of scope, approvals, and rollbacks.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-sm border border-slate-200">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              Scoped & controlled
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-sm border border-slate-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Transparent by design
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-sm border border-slate-200">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Reversible workflows
            </span>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-1 h-10 w-10 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center font-semibold">
                01
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-slate-900">Principles</h2>
                <p className="text-sm text-slate-600">The guardrails that govern every validation run.</p>
              </div>
            </div>
            <ul className="list-disc list-inside text-sm text-slate-700 space-y-2 pl-1">
              <li>
                <span className="font-medium text-slate-900">Scoped:</span> tests run only where you point them.
              </li>
              <li>
                <span className="font-medium text-slate-900">Reversible:</span> keep rollback plans and review outputs
                before acting.
              </li>
              <li>
                <span className="font-medium text-slate-900">Transparent:</span> PurveX does not auto-execute commands
                for you.
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-1 h-10 w-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-semibold">
                02
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-slate-900">What PurveX does</h2>
                <p className="text-sm text-slate-600">
                  How we run, observe, and report on validation without taking control away from you.
                </p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm text-slate-700">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <h3 className="font-semibold text-slate-900 mb-1.5">Orchestrate runs</h3>
                <p className="text-slate-600 leading-relaxed">
                  You select scope, environments, and timing; PurveX schedules and tracks each run with guardrails.
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <h3 className="font-semibold text-slate-900 mb-1.5">Capture context</h3>
                <p className="text-slate-600 leading-relaxed">
                  We collect telemetry evidence (queries, logs, signals) without modifying your detection content.
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <h3 className="font-semibold text-slate-900 mb-1.5">Report results</h3>
                <p className="text-slate-600 leading-relaxed">
                  Findings are summarized with reproducible steps, timestamps, and environment tags.
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <h3 className="font-semibold text-slate-900 mb-1.5">Keep you in control</h3>
                <p className="text-slate-600 leading-relaxed">
                  No auto-remediation or auto-deployment; you approve changes and rollbacks before they run.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
