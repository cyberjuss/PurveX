export default function PrivacyPage() {
  return (
    <div className="w-full max-w-7xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Legal</p>
        <h1 className="text-2xl font-semibold text-slate-900">Privacy</h1>
        <p className="text-sm text-slate-600">
          We prioritize customer privacy. PurveX does not sell customer data and limits collection to what is necessary
          to operate the service.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Data handling</h2>
        <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
          <li>We collect only operational data needed to deliver the product.</li>
          <li>We do not sell or share customer data with advertisers.</li>
          <li>Contact privacy@purvex.com for data requests.</li>
        </ul>
      </div>
    </div>
  );
}

