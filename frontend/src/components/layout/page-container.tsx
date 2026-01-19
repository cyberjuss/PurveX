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
    <div className={cn(
      "space-y-6 mx-auto w-full min-h-0",
      maxWidthClasses[maxWidth],
      className
    )}>
      {children}
    </div>
  );
}
