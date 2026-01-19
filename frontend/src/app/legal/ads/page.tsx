export default function AdsPage() {
  return (
    <div className="w-full max-w-7xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Advertise</p>
        <h1 className="text-2xl font-semibold text-slate-900">Advertising</h1>
        <p className="text-sm text-slate-600">
          PurveX focuses on product value for detection engineers. We do not sell customer data or inject ads into the
          product experience.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Our stance</h2>
        <p className="text-sm text-slate-700">
          We prioritize privacy, trust, and clarity. If you have partnership ideas that align with these principles,
          contact partnerships@purvex.com.
        </p>
      </div>
    </div>
  );
}

