"use client";

import Link from "next/link";

export default function AttributionPage() {
  return (
    <div className="w-full max-w-3xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--surface-subtle-foreground)]">Legal</p>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Attribution &amp; Third‑Party Projects</h1>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
          PurveX builds on open community work. We do not claim ownership of these projects or their trademarks, and they
          do not endorse PurveX.
        </p>
      </header>

      <section className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
        <h2 className="text-base font-semibold text-[var(--foreground)]">MITRE ATT&amp;CK&reg;</h2>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
          PurveX uses technique and tactic identifiers, names, and other reference data from{" "}
          <span className="font-medium text-[var(--foreground)]">MITRE ATT&amp;CK</span>, a globally accessible knowledge base of adversary
          tactics and techniques curated by The MITRE Corporation.
        </p>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
          MITRE owns the ATT&amp;CK content and associated trademarks. PurveX is an independent project that builds on
          this public knowledge base; MITRE does not endorse or sponsor PurveX.
        </p>
        <div className="text-xs text-[var(--surface-subtle-foreground)] space-y-1">
          <span className="block">
            Official ATT&amp;CK site:{" "}
            <Link href="https://attack.mitre.org" target="_blank" className="text-[var(--accent-strong)] hover:underline">
              attack.mitre.org
            </Link>
          </span>
          <span className="block">
            Terms of Use:{" "}
            <Link
              href="https://attack.mitre.org/resources/terms-of-use/"
              target="_blank"
              className="text-[var(--accent-strong)] hover:underline"
            >
              attack.mitre.org/resources/terms-of-use/
            </Link>
          </span>
        </div>
      </section>

      <section className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Sigma</h2>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
          PurveX supports detections defined in <span className="font-medium text-[var(--foreground)]">Sigma (Generic Signature Format for SIEM Systems)</span>. Sigma is an independent, community‑driven project. PurveX does not own or control Sigma, and the Sigma project does not endorse PurveX.
        </p>
        <p className="text-xs text-[var(--surface-subtle-foreground)]">
          Learn more at{" "}
          <Link href="https://github.com/SigmaHQ/sigma" target="_blank" className="text-[var(--accent-strong)] hover:underline">
            github.com/SigmaHQ/sigma
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Atomic Red Team</h2>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
          PurveX uses test content and ideas from <span className="font-medium text-[var(--foreground)]">Atomic Red Team</span>, an open source library of small, highly portable tests that exercise common adversary techniques. Atomic Red Team is created and maintained by <span className="font-medium text-[var(--foreground)]">Red Canary</span>.
        </p>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">PurveX’s use of Atomic Red Team content complies with the MIT license:</p>
        <ul className="list-disc list-inside text-sm leading-relaxed text-[var(--surface-subtle-foreground)] space-y-1">
          <li>We provide attribution to Red Canary and the Atomic Red Team project.</li>
          <li>We do not imply that Red Canary or Atomic Red Team endorse or sponsor PurveX.</li>
        </ul>
        <p className="text-xs text-[var(--surface-subtle-foreground)]">
          Learn more at{" "}
          <Link
            href="https://github.com/redcanaryco/atomic-red-team"
            target="_blank"
            className="text-[var(--accent-strong)] hover:underline"
          >
            github.com/redcanaryco/atomic-red-team
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Use in PurveX</h2>
        <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
          Within PurveX, ATT&amp;CK, Sigma, and Atomic Red Team artefacts are treated as reference and input content to
          help validate and tune customer detections. All PurveX‑specific logic, UI, workflows, and integrations are
          original work by the PurveX project.
        </p>
      </section>
    </div>
  );
}
