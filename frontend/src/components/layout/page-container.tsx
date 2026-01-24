"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageContainerProps {
  children: ReactNode;
  className?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
}

const maxWidthClasses = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-6xl",
  xl: "max-w-screen-xl",
  "2xl": "max-w-screen-2xl xl:max-w-[1800px]",
  full: "max-w-full",
};

export function PageContainer({
  children,
  className,
  maxWidth = "full",
}: PageContainerProps) {
  return (
    <div className="relative w-full">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(248,250,252,0.9),_transparent_55%),radial-gradient(circle_at_80%_10%,_rgba(226,232,240,0.55),_transparent_45%),radial-gradient(circle_at_20%_20%,_rgba(203,213,225,0.35),_transparent_50%)]" />
      <div
        className={cn(
          "relative mx-auto w-full min-h-0 space-y-6 px-4 pb-16 pt-10 sm:px-6 lg:px-8",
          maxWidthClasses[maxWidth],
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
