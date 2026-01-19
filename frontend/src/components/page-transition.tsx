"use client";

import { useEffect, useState, useRef, startTransition } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";

type Particle = {
  width: number;
  height: number;
  left: number;
  top: number;
  duration: number;
  delay: number;
};

// Deterministic particle set to avoid impure renders while keeping motion variety.
const PAGE_TRANSITION_PARTICLES: Particle[] = [
  { width: 3.5, height: 3.2, left: 8, top: 12, duration: 4.4, delay: 0.1 },
  { width: 2.2, height: 2.6, left: 22, top: 18, duration: 3.6, delay: 0.4 },
  { width: 3.8, height: 3.1, left: 35, top: 10, duration: 4.1, delay: 0.25 },
  { width: 2.4, height: 2.8, left: 48, top: 22, duration: 3.2, delay: 0.6 },
  { width: 3.1, height: 2.9, left: 62, top: 16, duration: 4.7, delay: 0.15 },
  { width: 2.9, height: 2.5, left: 75, top: 12, duration: 3.9, delay: 0.35 },
  { width: 3.3, height: 3.4, left: 88, top: 20, duration: 4.5, delay: 0.5 },
  { width: 2.1, height: 2.3, left: 12, top: 68, duration: 3.8, delay: 0.2 },
  { width: 3.0, height: 3.2, left: 26, top: 72, duration: 4.2, delay: 0.45 },
  { width: 2.7, height: 2.5, left: 41, top: 65, duration: 3.5, delay: 0.05 },
  { width: 3.6, height: 3.1, left: 55, top: 78, duration: 4.8, delay: 0.3 },
  { width: 2.5, height: 2.4, left: 68, top: 70, duration: 3.4, delay: 0.55 },
  { width: 3.4, height: 3.0, left: 80, top: 64, duration: 4.3, delay: 0.4 },
  { width: 2.6, height: 2.2, left: 90, top: 74, duration: 3.7, delay: 0.18 },
  { width: 3.2, height: 3.3, left: 50, top: 48, duration: 4.0, delay: 0.12 },
];

export function PageTransition() {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const pathname = usePathname();
  const prevPathnameRef = useRef<string | null>(null);
  const isInitialMount = useRef(true);
  const transitionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fadeOutTimerRef = useRef<NodeJS.Timeout | null>(null);

  const particles = PAGE_TRANSITION_PARTICLES;

  useEffect(() => {
    // Skip transition on initial mount (full page refresh uses LoadingSplash)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevPathnameRef.current = pathname;
      
      // Check if this is a full page refresh - if so, don't show transition
      if (typeof window !== "undefined") {
        let isPageRefresh = false;
        try {
          const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          if (navEntry) {
            isPageRefresh = navEntry.type === "reload";
          } else if (performance.navigation) {
            const legacyNav: PerformanceNavigation | undefined = performance.navigation;
            isPageRefresh = legacyNav?.type === PerformanceNavigation.TYPE_RELOAD;
          }
        } catch {
          // If we can't determine, assume it's a refresh if document was loading
          isPageRefresh = document.readyState === "loading";
        }
        
        if (isPageRefresh) {
          return;
        }
      }
      return;
    }

    // Only show transition if pathname actually changed (navigation between pages)
    if (pathname !== prevPathnameRef.current && prevPathnameRef.current !== null) {
      // Clear any existing timers first
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      if (fadeOutTimerRef.current) {
        clearTimeout(fadeOutTimerRef.current);
        fadeOutTimerRef.current = null;
      }
      
      // Reset state and start transition without blocking paint
      startTransition(() => {
        setIsFadingOut(false);
        setIsTransitioning(true);
      });
      
      const HOLD_DURATION = 1600;
      const FADE_DURATION = 400;
      
      transitionTimerRef.current = setTimeout(() => {
        setIsFadingOut(true);
      }, HOLD_DURATION);
      
      fadeOutTimerRef.current = setTimeout(() => {
        setIsTransitioning(false);
        setIsFadingOut(false);
      }, HOLD_DURATION + FADE_DURATION);
      
      prevPathnameRef.current = pathname;
      
      return () => {
        if (transitionTimerRef.current) {
          clearTimeout(transitionTimerRef.current);
          transitionTimerRef.current = null;
        }
        if (fadeOutTimerRef.current) {
          clearTimeout(fadeOutTimerRef.current);
          fadeOutTimerRef.current = null;
        }
      };
    } else {
      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  if (!isTransitioning) return null;

  return (
    <div 
      className={`fixed inset-0 z-[9998] flex items-center justify-center backdrop-blur-md transition-opacity duration-[320ms] ${
        isFadingOut ? "opacity-0" : "opacity-100"
      }`}
      style={{
        background: "linear-gradient(135deg, rgba(2,6,23,0.95) 0%, rgba(15,23,42,0.96) 25%, rgba(3,7,18,0.95) 50%, rgba(15,23,42,0.97) 75%, rgba(2,6,23,0.95) 100%)",
        backgroundSize: "400% 400%",
        animation: isFadingOut ? "none" : "gradient-shift 14s ease infinite"
      }}
      role="status"
      aria-live="polite"
      aria-label="Page transition in progress"
    >
      {/* Subtle animated background particles */}
      <div className="absolute inset-0 overflow-hidden">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-blue-400/12"
            style={{
              width: `${particle.width}px`,
              height: `${particle.height}px`,
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              animation: `float ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`
            }}
          />
        ))}
      </div>

      <div className="relative flex flex-col items-center gap-6 z-10">
        {/* Logo with subtle glow */}
        <div className="relative">
          {/* Subtle glow ring */}
          <div 
            className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-indigo-500/15 to-blue-600/20 blur-lg"
            style={{
              borderRadius: "22%",
              animation: "pulse-glow 2.5s ease-in-out infinite",
              transform: "scale(1.15)"
            }}
          />
          
          {/* Logo container */}
          <div 
            className="relative h-44 w-44 bg-white flex items-center justify-center shadow-xl"
            style={{
              borderRadius: "22%",
              animation: "fadeInScale 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), float-gentle 2.5s ease-in-out infinite",
              animationDelay: "0s, 0.8s"
            }}
          >
            <Image
              src="/logo.png"
              alt="PurveX Logo"
              width={120}
              height={120}
              className="object-contain drop-shadow-md"
              style={{
                animation: "fadeInScale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
                animationDelay: "0.2s",
                animationFillMode: "both"
              }}
              priority
            />
          </div>
        </div>

        {/* Animated dots */}
        <div className="flex items-center justify-center gap-3 mt-4" aria-hidden="true">
          <div 
            className="h-4 w-4 rounded-full bg-white/60"
            style={{
              animation: "dot-pulse 1.4s ease-in-out infinite",
              animationDelay: "0s"
            }}
          />
          <div 
            className="h-4 w-4 rounded-full bg-white/60"
            style={{
              animation: "dot-pulse 1.4s ease-in-out infinite",
              animationDelay: "0.2s"
            }}
          />
          <div 
            className="h-4 w-4 rounded-full bg-white/60"
            style={{
              animation: "dot-pulse 1.4s ease-in-out infinite",
              animationDelay: "0.4s"
            }}
          />
        </div>
      </div>
    </div>
  );
}
