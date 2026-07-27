export default function TermsPage() {
  return (
    <div className="w-full max-w-3xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--surface-subtle-foreground)]">Legal</p>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Terms of Service</h1>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
          These terms describe your responsibilities when using PurveX. They complement, not replace, any master service
          agreements you may have in place.
        </p>
      </header>

      <div className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Key points</h2>
        <ul className="list-disc list-inside text-sm leading-relaxed text-[var(--surface-subtle-foreground)] space-y-1">
          <li>Use PurveX only in environments you are authorized to test.</li>
          <li>Do not attempt to misuse or disrupt the service.</li>
          <li>Respect third‑party licenses and attribution.</li>
        </ul>
      </div>
    </div>
  );
}
