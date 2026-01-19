export default function CopyrightPage() {
  return (
    <div className="w-full max-w-7xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Legal</p>
        <h1 className="text-2xl font-semibold text-slate-900">Copyright</h1>
        <p className="text-sm text-slate-600">
          PurveX respects the intellectual property of others. We attribute third‑party content and do not claim
          ownership of external projects or trademarks.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Copyright notice</h2>
        <p className="text-sm text-slate-700">
          All PurveX UI, workflows, integrations, and original content are © 2025 PurveX. Third‑party artefacts are
          used under their respective licenses and are credited accordingly.
        </p>
      </div>
    </div>
  );
}

