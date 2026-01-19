"use client";

import Link from "next/link";

export default function AttributionPage() {
  return (
    <div className="w-full max-w-7xl min-w-0 mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-8 space-y-6 transition-colors duration-200">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Legal</p>
        <h1 className="text-2xl font-semibold text-slate-900">Attribution &amp; Third‑Party Projects</h1>
        <p className="text-sm text-slate-600">
          PurveX builds on open community work. We do not claim ownership of these projects or their trademarks, and they
          do not endorse PurveX.
        </p>
      </header>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white shadow-sm p-5 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">MITRE ATT&amp;CK&reg;</h2>
        <p className="text-sm text-slate-700">
          PurveX uses technique and tactic identifiers, names, and other reference data from{" "}
          <span className="font-semibold">MITRE ATT&amp;CK</span>, a globally accessible knowledge base of adversary
          tactics and techniques curated by The MITRE Corporation.
        </p>
        <p className="text-sm text-slate-700">
          MITRE owns the ATT&amp;CK content and associated trademarks. PurveX is an independent project that builds on
          this public knowledge base; MITRE does not endorse or sponsor PurveX.
        </p>
        <div className="text-xs text-slate-600 space-y-1">
          <span className="block">
            Official ATT&amp;CK site:{" "}
            <Link href="https://attack.mitre.org" target="_blank" className="text-indigo-600 hover:underline">
              attack.mitre.org
            </Link>
          </span>
          <span className="block">
            Terms of Use:{" "}
            <Link
              href="https://attack.mitre.org/resources/terms-of-use/"
              target="_blank"
              className="text-indigo-600 hover:underline"
            >
              attack.mitre.org/resources/terms-of-use/
            </Link>
          </span>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white shadow-sm p-5 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Sigma</h2>
        <p className="text-sm text-slate-700">
          PurveX supports detections defined in <span className="font-semibold">Sigma (Generic Signature Format for SIEM Systems)</span>. Sigma is an independent, community‑driven project. PurveX does not own or control Sigma, and the Sigma project does not endorse PurveX.
        </p>
        <p className="text-xs text-slate-600">
          Learn more at{" "}
          <Link href="https://github.com/SigmaHQ/sigma" target="_blank" className="text-indigo-600 hover:underline">
            github.com/SigmaHQ/sigma
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white shadow-sm p-5 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Atomic Red Team</h2>
        <p className="text-sm text-slate-700">
          PurveX uses test content and ideas from <span className="font-semibold">Atomic Red Team</span>, an open source library of small, highly portable tests that exercise common adversary techniques. Atomic Red Team is created and maintained by <span className="font-semibold">Red Canary</span>.
        </p>
        <p className="text-sm text-slate-700">PurveX’s use of Atomic Red Team content complies with the MIT license:</p>
        <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
          <li>We provide attribution to Red Canary and the Atomic Red Team project.</li>
          <li>We do not imply that Red Canary or Atomic Red Team endorse or sponsor PurveX.</li>
        </ul>
        <p className="text-xs text-slate-600">
          Learn more at{" "}
          <Link
            href="https://github.com/redcanaryco/atomic-red-team"
            target="_blank"
            className="text-indigo-600 hover:underline"
          >
            github.com/redcanaryco/atomic-red-team
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white shadow-sm p-5 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md">
        <h2 className="text-lg font-semibold text-slate-900">Use in PurveX</h2>
        <p className="text-sm text-slate-700">
          Within PurveX, ATT&amp;CK, Sigma, and Atomic Red Team artefacts are treated as reference and input content to
          help validate and tune customer detections. All PurveX‑specific logic, UI, workflows, and integrations are
          original work by the PurveX project.
        </p>
      </section>
    </div>
  );
}


