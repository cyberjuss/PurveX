export default function AboutPage() {
  return (
    <div className="w-full min-w-0 space-y-6 transition-colors duration-200 pb-8">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Our focus</h2>
        <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
          <li>Make validation workflows fast, repeatable, and trustworthy.</li>
          <li>Give SOC and detection engineers a joyful, high-clarity experience.</li>
          <li>Respect the open communities we build upon.</li>
        </ul>
      </div>
    </div>
  );
}
