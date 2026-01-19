export default function SafetyPage() {
  return (
    <div className="w-full max-w-7xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Legal</p>
        <h1 className="text-2xl font-semibold text-slate-900">Safety</h1>
        <p className="text-sm text-slate-600">
          PurveX is built to keep testing scoped, reversible, and safe. Use it only in approved environments.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Safe usage</h2>
        <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
          <li>Run tests only on environments you control and have approval for.</li>
          <li>Ensure rollback plans for any changes you introduce.</li>
          <li>Validate telemetry paths before assuming coverage.</li>
        </ul>
      </div>
    </div>
  );
}

