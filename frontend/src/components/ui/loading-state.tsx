import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface LoadingStateProps {
  message?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const iconSizes = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

const padding = {
  sm: "py-4",
  md: "py-8",
  lg: "py-12",
};

export function LoadingState({
  message = "Loading...",
  size = "md",
  className,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-16 items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-400",
        padding[size],
        className,
      )}
    >
      <Loader2 className={cn("shrink-0 animate-spin", iconSizes[size])} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

