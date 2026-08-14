"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Copy as CopyIcon } from "lucide-react";
import {
  type AtomicTestDefinition,
  type MitreTechnique,
  getAtomicCatalogStatus,
  downloadAtomicCatalog,
  getAtomicTests,
  getMitreTechniques,
} from "@/lib/api";
import { buildRunTestHref } from "@/app/run-test/lib/run-test-url";

export default function TechniqueExplorePage() {
  const params = useParams<{ techniqueId: string }>();
  const techniqueId = decodeURIComponent(params.techniqueId);

  const [mitre, setMitre] = useState<MitreTechnique | null>(null);
  const [mitreById, setMitreById] = useState<Record<string, MitreTechnique>>({});
  const [atomics, setAtomics] = useState<AtomicTestDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [editCommands, setEditCommands] = useState<Record<string, string>>({});
  const [catalogStatus, setCatalogStatus] = useState<{ installed: boolean; count: number; path: string } | null>(null);
  const [installing, setInstalling] = useState(false);

  const totalAtomics = atomics.length;
  const uniquePlatforms = Array.from(new Set(atomics.flatMap((t) => t.platforms || [])));
  const anyLabSafe = atomics.some((t) => t.is_safe);
  const allLabSafe = atomics.length > 0 && atomics.every((t) => t.is_safe);
  const safetyLabel = allLabSafe ? "Lab-safe set" : anyLabSafe ? "Mixed safety" : "Review carefully";
  const safetyTone =
    allLabSafe || anyLabSafe
      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : "bg-amber-50 text-amber-700 border border-amber-200";
  const summaryRunHref = buildRunTestHref({
    t: techniqueId,
    a: atomics[0]?.id ? String(atomics[0].id) : undefined,
  });
  const summaryAtomicDocs = `https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/${techniqueId}/${techniqueId}.md`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const baseId = techniqueId.split(".")[0];
        const [mitreAll, atomicRes] = await Promise.all([
          getMitreTechniques().catch(() => [] as MitreTechnique[]),
          // Ask backend for tests where technique_id is either the exact id
          // or any sub-technique under the same parent (e.g. T1059 + T1059.001).
          getAtomicTests({ technique_id: baseId, limit: 500 }),
        ]);
        if (cancelled) return;
        const rawAtomics = (atomicRes.items || []) as AtomicTestDefinition[];

        const q = search.trim().toLowerCase();
        const filtered =
          q.length === 0
            ? rawAtomics
            : rawAtomics.filter((test) => {
                const haystack = [
                  test.name,
                  test.description,
                  test.technique_id,
                  ...(test.platforms || []),
                ]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase();
                return haystack.includes(q);
              });

        const mitreIndex: Record<string, MitreTechnique> = {};
        for (const t of mitreAll) {
          mitreIndex[t.id] = t;
        }
        setMitre(mitreAll.find((t) => t.id === techniqueId) || null);
        setMitreById(mitreIndex);
        setAtomics(filtered);

        // Seed default command previews for each test (without executing them).
        const nextCommands: Record<string, string> = {};
        for (const test of filtered) {
          const existing = editCommands[test.id];
          nextCommands[test.id] =
            existing ||
            `Invoke-AtomicTest ${test.technique_id} -TestNames \"${test.name}\" -GetPrereqs`;
        }
        setEditCommands(nextCommands);
      } catch {
        // apiFetch already logs; surface a generic error to the user.
        if (!cancelled) {
          setError("We couldn\u2019t load Atomic tests for this technique. Please try again.");
          setAtomics([]);
          try {
            const status = await getAtomicCatalogStatus();
            if (!cancelled) setCatalogStatus(status);
          } catch {
            if (!cancelled) setCatalogStatus(null);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [techniqueId, search]);

  async function handleDownloadCatalog() {
    setInstalling(true);
    try {
      await downloadAtomicCatalog();
      const status = await getAtomicCatalogStatus();
      setCatalogStatus(status);
      setError(null);
    } catch {
      setError("We couldn\u2019t download the Atomic catalog. Please try again.");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex justify-end">
        <a
          href={`https://attack.mitre.org/techniques/${
            techniqueId.includes(".") ? techniqueId.replace(".", "/") : techniqueId
          }/`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-900 hover:bg-slate-50"
        >
          Open on MITRE ATT&amp;CK
        </a>
      </div>

      <div className="grid grid-cols-1 gap-5">
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg font-semibold text-slate-900">
              {techniqueId}
              {mitre?.name ? ` - ${mitre.name}` : ""}
            </CardTitle>
            <p className="mt-1 text-[11px] text-slate-600">
              Atomic Red Team tests mapped to this MITRE technique. Choose a test to inspect and
              then run it from your lab workflow.
            </p>
            {mitre?.tactics?.length ? (
              <p className="mt-1 text-[10px] text-slate-500">
                Tactic: {mitre.tactics.join(", ")}
              </p>
            ) : null}
          </div>
          <div className="w-64">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter atomic tests"
              className="h-9 bg-white border-slate-200 text-[12px] text-slate-900 placeholder:text-slate-500"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-xs text-slate-600">Loading atomic tests...</p>}
          {error && !loading && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-red-600">{error}</p>
              <p className="text-[11px] text-slate-600">
                Atomic Red Team catalog is not installed on this host yet.
              </p>
              {catalogStatus?.path && (
                <p className="text-[11px] text-slate-500">
                  Expected location: <span className="text-slate-700">{catalogStatus.path}</span>
                </p>
              )}
              <Button type="button" onClick={handleDownloadCatalog} disabled={installing} className="h-8 px-3 text-[11px]">
                {installing ? "Downloading catalog..." : "Download test catalog"}
              </Button>
            </div>
          )}
          {!loading && !error && atomics.length === 0 && (
            <p className="text-xs text-slate-600">
              No Atomic Red Team tests are currently cataloged for this technique. Your admin can
              extend the Atomic catalog over time.
            </p>
          )}
          {!loading && !error && atomics.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                <span className="font-semibold text-slate-900">Total tests:</span>
                <span>{totalAtomics}</span>
                <span className="text-slate-400">|</span>
                <span className="font-semibold text-slate-900">Platforms:</span>
                <span>{uniquePlatforms.length ? uniquePlatforms.join(", ") : "N/A"}</span>
                <span className="text-slate-400">|</span>
                <span className="font-semibold text-slate-900">Safety:</span>
                <span className={`inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border ${safetyTone}`}>
                  {safetyLabel}
                </span>
              </div>
              {Object.entries(
                atomics.reduce<Record<string, AtomicTestDefinition[]>>((acc, test) => {
                  const key = test.technique_id || "UNKNOWN";
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(test);
                  return acc;
                }, {}),
              )
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([techId, tests]) => {
                  const isOpen = expandedGroups[techId] ?? false;
                  const meta = mitreById[techId];
                  const allPlatforms = Array.from(
                    new Set(
                      tests.flatMap((t) => t.platforms || []),
                    ),
                  );
                  const isGroupSafe = tests.every((t) => t.is_safe);
                  const mitreUrl = `https://attack.mitre.org/techniques/${
                    techId.includes(".") ? techId.replace(".", "/") : techId
                  }/`;
                  const atomicDocsUrl = `https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/${techId}/${techId}.md`;

                  return (
                    <div
                      key={techId}
                      className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm"
                    >
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 bg-white"
                        onClick={() =>
                          setExpandedGroups((prev) => ({ ...prev, [techId]: !isOpen }))
                        }
                      >
                        <div className="flex flex-col gap-1">
                          <div className="text-[12px] font-semibold text-slate-900">
                            {techId}
                            {meta?.name ? ` - ${meta.name}` : ""}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 px-2 py-[2px] text-[10px] text-slate-700">
                              {tests.length} Atomic test{tests.length === 1 ? "" : "s"}
                            </span>
                            {allPlatforms.length > 0 && (
                              <span className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 px-2 py-[2px] text-[10px] text-slate-700">
                                {allPlatforms.join(" / ")}
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border ${
                                isGroupSafe
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}
                            >
                              {isGroupSafe ? "Lab-safe set" : "Review carefully"}
                            </span>
                            <a
                              href={mitreUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 transition-colors"
                            >
                              Open ATT&amp;CK
                            </a>
                            <a
                              href={atomicDocsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 transition-colors"
                            >
                              Atomic docs
                            </a>
                          </div>
                        </div>
                        <span className="text-slate-500 text-xs ml-2">
                          {isOpen ? "-" : "+"}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-slate-200 divide-y divide-slate-100 bg-white">
                          {tests.map((test) => {
                            return (
                              <div
                                key={test.id}
                                className="px-4 py-4 flex flex-col gap-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <div className="text-[12px] font-semibold text-slate-900">
                                      {test.name}
                                    </div>
                                    {test.description && (
                                      <div className="text-[11px] text-slate-600">
                                        {test.description}
                                      </div>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                    {test.platforms?.length > 0 && (
                                        <span className="text-[10px] text-slate-600 uppercase tracking-[0.16em]">
                                        {test.platforms.join(", ")}
                                      </span>
                                    )}
                                    <Badge
                                      className={
                                        test.is_safe
                                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                            : "bg-amber-50 text-amber-700 border border-amber-200"
                                      }
                                    >
                                      {test.is_safe ? "Lab-safe" : "Use with caution"}
                                    </Badge>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Link
                                      href={buildRunTestHref({
                                        t: test.technique_id,
                                        a: test.id ? String(test.id) : undefined,
                                      })}
                                    >
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 px-3.5 bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 text-[11px]"
                                      >
                                        Run
                                      </Button>
                                    </Link>
                                  </div>
                                </div>
                                <div className="mt-1">
                                  <p className="mb-1 text-[10px] text-slate-700">
                                    Example lab command (editable &amp; never executed by PurveX):
                                  </p>
                                  <div className="relative">
                                    <textarea
                                      value={editCommands[test.id] || ""}
                                      onChange={(e) =>
                                        setEditCommands((prev) => ({
                                          ...prev,
                                          [test.id]: e.target.value,
                                        }))
                                      }
                                      className="w-full h-20 bg-white border border-slate-200 rounded-md text-[11px] font-mono text-slate-900 px-2 py-1 pr-7 resize-y"
                                    />
                                    <button
                                      type="button"
                                      aria-label="Copy command"
                                      title="Copy command"
                                      className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                                      onClick={() => {
                                        const cmd = editCommands[test.id] || "";
                                        if (cmd && typeof navigator !== "undefined") {
                                          navigator.clipboard?.writeText(cmd).catch(() => {});
                                        }
                                      }}
                                    >
                                      <CopyIcon className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                  <p className="mt-1 text-[10px] text-slate-600">
                                    Copy this into your isolated lab VM to run the test. PurveX only
                                    records this command for context; it does not execute it.
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </div>
  );
}
