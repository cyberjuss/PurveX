export default function TermsPage() {
  return (
    <div className="w-full max-w-7xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Legal</p>
        <h1 className="text-2xl font-semibold text-slate-900">Terms of Service</h1>
        <p className="text-sm text-slate-600">
          These terms describe your responsibilities when using PurveX. They complement, not replace, any master service
          agreements you may have in place.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Key points</h2>
        <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
          <li>Use PurveX only in environments you are authorized to test.</li>
          <li>Do not attempt to misuse or disrupt the service.</li>
          <li>Respect third‑party licenses and attribution.</li>
        </ul>
      </div>
    </div>
  );
}

