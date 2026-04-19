"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ShieldCheck, Play, ArrowRight, X } from "lucide-react";

interface FirstRunOnboardingProps {
  onDismiss?: () => void;
  headline?: string;
  nextActionHref?: string;
}

export function FirstRunOnboarding({
  onDismiss,
  headline = "Validate detections, prove coverage, and show what to fix next.",
  nextActionHref = "/detections",
}: FirstRunOnboardingProps) {
  const [dismissed, setDismissed] = useState(false);
  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (dismissed) return null;

  return (
    <Card className="border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-sky-50">
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg font-display text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-sky-600" />
            Welcome to PurveX
          </CardTitle>
          <CardDescription className="text-slate-600 text-sm mt-1">
            {headline}
          </CardDescription>
        </div>
        <button
          onClick={handleDismiss}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          aria-label="Dismiss onboarding"
        >
          <X className="h-5 w-5" />
        </button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          {[
            "Connect your data source",
            "Add detections to validate",
            "Run your first validation",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm text-slate-700">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 md:items-end md:min-w-[220px]">
          <Button className="w-full md:w-auto" asChild>
            <Link href={nextActionHref}>
              Open detections
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full md:w-auto text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            asChild
          >
            <Link href="/run-test">
              Run first validation
              <Play className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

