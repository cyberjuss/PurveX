export default function AboutPage() {
  return (
    <div className="w-full min-w-0 space-y-6 transition-colors duration-200 pb-8">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">The outcome that matters</h2>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            This platform should not just help someone click through a workflow. It should help them
            stop guessing, trust their judgment, and feel the difference in the way they work every day.
          </p>
          <p>
            The goal is practical transformation: less anxiety before incidents, less wasted effort,
            faster feedback loops, stronger decisions, and visible improvement that compounds into career growth.
          </p>
          <p>
            If PurveX does its job well, the user&apos;s future changes. They become more credible, more effective,
            and more prepared than they were before they touched it.
          </p>
        </div>
      </div>
    </div>
  );
}
