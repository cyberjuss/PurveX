"use client";

import { useEffect, useState, useRef } from "react";
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

const SPLASH_PARTICLES: Particle[] = [
  { width: 4, height: 3.5, left: 10, top: 14, duration: 5.2, delay: 0.1 },
  { width: 3, height: 3.2, left: 24, top: 8, duration: 4.4, delay: 0.3 },
  { width: 3.6, height: 3.4, left: 38, top: 18, duration: 4.9, delay: 0.15 },
  { width: 2.8, height: 2.6, left: 52, top: 12, duration: 4.2, delay: 0.5 },
  { width: 3.3, height: 3.0, left: 66, top: 16, duration: 4.6, delay: 0.2 },
  { width: 3.8, height: 3.1, left: 78, top: 10, duration: 5.0, delay: 0.35 },
  { width: 2.7, height: 2.4, left: 90, top: 20, duration: 4.0, delay: 0.55 },
  { width: 3.1, height: 3.1, left: 8, top: 72, duration: 4.3, delay: 0.25 },
  { width: 2.9, height: 2.7, left: 22, top: 65, duration: 4.1, delay: 0.45 },
  { width: 3.4, height: 3.2, left: 36, top: 78, duration: 4.7, delay: 0.12 },
  { width: 2.6, height: 2.5, left: 50, top: 70, duration: 3.9, delay: 0.38 },
  { width: 3.5, height: 3.3, left: 64, top: 74, duration: 4.8, delay: 0.18 },
  { width: 2.5, height: 2.3, left: 76, top: 66, duration: 3.8, delay: 0.52 },
  { width: 3.2, height: 3.0, left: 88, top: 62, duration: 4.5, delay: 0.28 },
  { width: 3.7, height: 3.2, left: 30, top: 44, duration: 4.6, delay: 0.22 },
  { width: 2.8, height: 2.6, left: 48, top: 50, duration: 4.0, delay: 0.4 },
  { width: 3.1, height: 3.0, left: 62, top: 40, duration: 4.3, delay: 0.16 },
  { width: 2.9, height: 2.7, left: 74, top: 52, duration: 4.1, delay: 0.48 },
  { width: 3.3, height: 3.2, left: 86, top: 46, duration: 4.5, delay: 0.34 },
  { width: 2.7, height: 2.5, left: 16, top: 48, duration: 3.9, delay: 0.3 },
];

export function LoadingSplash() {
  const [isLoading, setIsLoading] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const minDisplayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fadeOutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    // Hide immediate splash once React component is mounted
    const immediateSplash = document.getElementById("immediate-splash");
    if (immediateSplash) {
      immediateSplash.style.display = "none";
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }

    // Hide scrollbar when loading starts
    const hideScrollbar = () => {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    };

    // Show scrollbar when loading finishes
    const showScrollbar = () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      // Force remove any inline styles that might persist
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
    };

    const startFadeOut = () => {
      // Clear any existing timers
      if (minDisplayTimerRef.current) {
        clearTimeout(minDisplayTimerRef.current);
        minDisplayTimerRef.current = null;
      }
      if (fadeOutTimerRef.current) {
        clearTimeout(fadeOutTimerRef.current);
        fadeOutTimerRef.current = null;
      }

      // Always show splash for 3 seconds.
      hideScrollbar();
      setIsLoading(true);
      setIsFadingOut(false);

      minDisplayTimerRef.current = setTimeout(() => {
        setIsFadingOut(true);
        // Remove from DOM after fade animation completes
        fadeOutTimerRef.current = setTimeout(() => {
          setIsLoading(false);
          setIsFadingOut(false);
          // Restore scrollbar after splash is completely gone
          showScrollbar();
        }, 500);
      }, 3000);
    };

    startFadeOut();

    // Safety: Always ensure scrollbar is restored after splash should be done
    const restoreScrollbarTimeout = setTimeout(() => {
      showScrollbar();
    }, 3600);

    return () => {
      if (minDisplayTimerRef.current) {
        clearTimeout(minDisplayTimerRef.current);
        minDisplayTimerRef.current = null;
      }
      if (fadeOutTimerRef.current) {
        clearTimeout(fadeOutTimerRef.current);
        fadeOutTimerRef.current = null;
      }
      if (restoreScrollbarTimeout) {
        clearTimeout(restoreScrollbarTimeout);
      }
      // Always restore scrollbar on cleanup
      showScrollbar();
    };
  }, [pathname]);

  // Always show on initial render for page refresh, hide only when explicitly set to false
  if (!isLoading) return null;

  return (
    <div 
      data-loading-splash="true"
      className={`fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-500 ${
        isFadingOut ? "opacity-0" : "opacity-100"
      }`}
      style={{
        background: "linear-gradient(135deg, #020617 0%, #0f172a 25%, #020617 50%, #0f172a 75%, #020617 100%)",
        backgroundSize: "400% 400%",
        animation: isFadingOut ? "none" : "gradient-shift 8s ease infinite"
      }}
    >
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden">
        {SPLASH_PARTICLES.map((particle, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-blue-500/10"
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

      <div className="relative flex flex-col items-center gap-8 z-10">
        {/* Logo with enhanced glow and animation */}
        <div className="relative">
          {/* Outer glow rings */}
          <div 
            className="absolute inset-0 bg-gradient-to-br from-blue-500/30 via-indigo-500/20 to-blue-600/30 blur-xl"
            style={{
              borderRadius: "22%",
              animation: "pulse-glow 2s ease-in-out infinite",
              transform: "scale(1.2)"
            }}
          />
          <div 
            className="absolute inset-0 bg-gradient-to-br from-blue-400/20 via-indigo-400/10 to-blue-500/20 blur-2xl"
            style={{
              borderRadius: "22%",
              animation: "pulse-glow 2.5s ease-in-out infinite",
              animationDelay: "0.5s",
              transform: "scale(1.4)"
            }}
          />
          
          {/* Logo container - rounded square shape (app icon style) */}
          <div 
            className="relative h-48 w-48 bg-white flex items-center justify-center shadow-2xl shadow-blue-500/30"
            style={{
              borderRadius: "22%",
              animation: "fadeInScale 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), float-gentle 3s ease-in-out infinite",
              animationDelay: "0s, 1s"
            }}
          >
            <Image
              src="/logo.png"
              alt="PurveX Logo"
              width={128}
              height={128}
              className="object-contain drop-shadow-lg"
              style={{
                animation: "fadeInScale 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
                animationDelay: "0.3s",
                animationFillMode: "both"
              }}
              priority
            />
          </div>
        </div>
        
        {/* Simple dot loader */}
        <div 
          className="flex items-center gap-3"
          style={{
            animation: "fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
            animationDelay: "0.5s",
            animationFillMode: "both"
          }}
        >
          <span className="h-4 w-4 rounded-full bg-white/90 animate-bounce" style={{ animationDelay: "0s" }} />
          <span className="h-4 w-4 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: "0.12s" }} />
          <span className="h-4 w-4 rounded-full bg-white/70 animate-bounce" style={{ animationDelay: "0.24s" }} />
        </div>
      </div>

    </div>
  );
}
