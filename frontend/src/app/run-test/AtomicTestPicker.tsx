"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AtomicTestDefinition, getAtomicCatalogStatus, downloadAtomicCatalog, getAtomicTests } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface AtomicTestPickerProps {
  selectedAtomicId: string | null;
  onChange: (test: AtomicTestDefinition | null) => void;
}

export function AtomicTestPicker({ selectedAtomicId, onChange }: AtomicTestPickerProps) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<AtomicTestDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState<{ installed: boolean; count: number; path: string } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setUnavailable(false);
      try {
        const res = await getAtomicTests({ q: search, limit: 50 });
        if (!cancelled) {
          setItems(res.items || []);
        }
      } catch {
        // Backend may not have /atomic endpoints yet – fail gracefully.
        if (!cancelled) {
          setUnavailable(true);
          setItems([]);
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
  }, [search, refreshTick]);

  async function handleDownloadCatalog() {
    setInstalling(true);
    try {
      await downloadAtomicCatalog();
      setUnavailable(false);
      setCatalogStatus(await getAtomicCatalogStatus());
      setRefreshTick((prev) => prev + 1);
    } catch {
      setUnavailable(true);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Card className="elite-card ">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-semibold text-slate-100">
              Choose Atomic Red Team test (optional)
            </CardTitle>
            <p className="text-[11px] text-slate-400 mt-1">
              Browse Atomic Red Team techniques and pick a specific atomic to execute in your lab.
            </p>
          </div>
          <div className="w-64">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search technique or name…"
              className="h-8 bg-slate-900/80 border-slate-700 text-[11px] text-slate-100 placeholder:text-slate-500"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-72 overflow-y-auto">
        {unavailable && (
          <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/70 p-3">
            <p className="text-xs text-slate-300">
              Atomic Red Team catalog is not installed yet.
            </p>
            {catalogStatus?.path && (
              <p className="text-[11px] text-slate-400">
                Expected location: <span className="text-slate-200">{catalogStatus.path}</span>
              </p>
            )}
            <Button
              type="button"
              onClick={handleDownloadCatalog}
              disabled={installing}
              className="h-8 px-3 text-[11px]"
            >
              {installing ? "Downloading catalog..." : "Download test catalog"}
            </Button>
          </div>
        )}
        {!unavailable && loading && (
          <p className="text-xs text-slate-400">Loading atomic tests…</p>
        )}
        {!unavailable && !loading && items.length === 0 && (
          <p className="text-xs text-slate-400">No atomic tests match this search.</p>
        )}
        {!unavailable &&
          items.map((test) => {
            const isSelected = test.id === selectedAtomicId;
            return (
              <button
                key={test.id}
                type="button"
                onClick={() => onChange(isSelected ? null : test)}
                className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors
                  ${
                    isSelected
                      ? "border-emerald-400 bg-emerald-500/10"
                      : "border-slate-700 bg-slate-900/60 hover:border-emerald-400"
                  }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-100 text-[12px]">
                      {test.technique_id} · {test.name}
                    </div>
                    {test.description && (
                      <div className="text-[11px] text-slate-400 line-clamp-2">
                        {test.description}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {test.platforms?.length > 0 && (
                      <span className="text-[10px] text-slate-400 uppercase tracking-[0.16em]">
                        {test.platforms.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
      </CardContent>
    </Card>
  );
}

