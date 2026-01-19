export default function ContactPage() {
  return (
    <div className="w-full min-w-0 space-y-6 transition-colors duration-200 pb-8">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">How to reach us</h2>
        <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
          <li>Email: support@purvex.com</li>
          <li>Partnerships: partnerships@purvex.com</li>
          <li>Press: press@purvex.com</li>
        </ul>
      </div>
    </div>
  );
}
