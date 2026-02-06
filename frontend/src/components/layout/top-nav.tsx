 "use client";

import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { getTests } from "@/lib/api";

type AlertState = "idle" | "success" | "fail" | "running";

export function NotificationBell({
  className,
  placement = "fixed",
}: {
  className?: string;
  placement?: "fixed" | "inline";
}) {
  const [alertState, setAlertState] = useState<AlertState>("idle");

  useEffect(() => {
    let lastResult: string | undefined;
    async function refreshStatus() {
      try {
        const tests = await getTests();
        const latest = tests[0];
        if (!latest) {
          setAlertState("idle");
          lastResult = undefined;
          return;
        }
        const currentResult = latest.result || undefined;
        if (currentResult !== lastResult) {
          lastResult = currentResult;
          if (latest.result === "FAIL") {
            setAlertState("fail");
          } else if (latest.result === "PASS") {
            setAlertState("success");
          } else if (latest.status === "running") {
            setAlertState("running");
          } else {
            setAlertState("idle");
          }
        }
      } catch {
        setAlertState("idle");
      }
    }

    refreshStatus();
    const interval = setInterval(refreshStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const buttonClasses = useMemo(() => {
    switch (alertState) {
      case "fail":
        return "text-red-300 hover:text-red-100";
      case "success":
        return "text-emerald-300 hover:text-emerald-100";
      case "running":
        return "text-yellow-300 hover:text-yellow-100";
      default:
        return "text-muted-foreground hover:text-foreground";
    }
  }, [alertState]);

  const ariaLabel = useMemo(() => {
    switch (alertState) {
      case "fail":
        return "Event: latest test failed";
      case "success":
        return "Notification: latest test passed";
      case "running":
        return "Notification: test is running";
      default:
        return "Notifications";
    }
  }, [alertState]);

  const isFixed = placement === "fixed";
  return (
    <div
      className={cn(
        isFixed
          ? "fixed top-4 right-5 z-50 rounded-full border border-white/15 bg-sidebar/90 p-2 shadow-[0_15px_35px_rgba(1,8,25,0.6)] backdrop-blur"
          : "inline-flex items-center justify-center rounded-full border border-white/20 bg-sidebar/80 p-2",
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className={buttonClasses}
        aria-label={ariaLabel}
      >
        <Bell className="h-5 w-5" />
      </Button>
    </div>
  );
}
