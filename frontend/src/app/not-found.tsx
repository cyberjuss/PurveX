import Link from "next/link";
import { Compass } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-xl rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_20px_48px_-36px_rgba(15,23,42,0.55)]">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Compass className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-display font-semibold text-slate-900">Page not found</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The route you requested does not exist or is no longer available in this workspace.
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild>
              <Link href="/dashboard">Return to dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
