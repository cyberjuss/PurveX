export default function PrivacyPage() {
  return (
    <div className="w-full max-w-3xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--surface-subtle-foreground)]">Legal</p>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Privacy</h1>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
          We prioritize customer privacy. PurveX does not sell customer data and limits collection to what is necessary
          to operate the service.
        </p>
      </header>

      <div className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Data handling</h2>
        <ul className="list-disc list-inside text-sm leading-relaxed text-[var(--surface-subtle-foreground)] space-y-1">
          <li>We collect only operational data needed to deliver the product.</li>
          <li>We do not sell or share customer data with advertisers.</li>
          <li>Contact privacy@purvex.com for data requests.</li>
        </ul>
      </div>
    </div>
  );
}
