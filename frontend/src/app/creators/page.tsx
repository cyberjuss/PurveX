export default function CreatorsPage() {
  return (
    <div className="w-full min-w-0 space-y-6 transition-colors duration-200 pb-8">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Built on work that already changed lives</h2>
        <p className="text-sm text-slate-700">
          PurveX depends on communities like MITRE ATT&amp;CK, Sigma, and Atomic Red Team because real transformation
          in security work is collective. We credit the people and projects that make practitioners sharper, and we do
          not claim endorsement by them.
        </p>
      </div>
    </div>
  );
}
