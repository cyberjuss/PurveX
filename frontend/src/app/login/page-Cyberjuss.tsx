"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { getApiBaseCandidates } from "@/lib/api";
import TwoFactorVerify from "@/components/auth/TwoFactorVerify";
import {
  Loader2,
  Shield,
  AlertCircle,
  User,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
  LockKeyhole,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "auth" | "2fa">("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);

  const API_URL =
    typeof window !== "undefined"
      ? getApiBaseCandidates()[0] || "http://127.0.0.1:8001"
      : process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
  
  // Log API URL for debugging
  if (typeof window !== "undefined") {
    console.log("[PurveX] API URL candidates:", getApiBaseCandidates());
    console.log("[PurveX] Using API URL:", API_URL);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    console.log("[PurveX] Form submitted", { username, hasPassword: !!password });
    
    if (!username || !password) {
      setError("Please enter both username and password");
      return;
    }
    
    setError(null);
    setPhase("auth");

    try {
      console.log("[PurveX] Attempting login to", API_URL);
      const form = new URLSearchParams();
      form.append("username", username);
      form.append("password", password);

      const loginUrl = `${API_URL}/auth/login`;
      console.log("[PurveX] Attempting login to:", loginUrl);
      
      const res = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        credentials: "include",
        mode: "cors",
      }).catch((fetchError) => {
        console.error("[PurveX] Fetch error:", fetchError);
        throw fetchError;
      });

      console.log("[PurveX] Login response status:", res.status, res.statusText);

      if (!res.ok) {
        let errorMessage = "Login failed";
        try {
          const data = await res.json();
          console.error("[PurveX] Login failed:", data);
          errorMessage = data.detail || data.message || `Login failed with status ${res.status}`;
        } catch (parseError) {
          // If response isn't JSON, try to get text
          try {
            const text = await res.text();
            console.error("[PurveX] Login failed (non-JSON):", text);
            errorMessage = text || `Login failed with status ${res.status}`;
          } catch (textError) {
            console.error("[PurveX] Login failed (could not parse response):", res.status, res.statusText);
            errorMessage = `Login failed with status ${res.status}: ${res.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }

      const data = await res.json().catch(() => ({}));
      console.log("[PurveX] Login successful, data:", { requires_2fa: data.requires_2fa, has_token: !!data.access_token });
      
      if (data.requires_2fa) {
        if (!data.two_factor_token) {
          throw new Error("Two-factor authentication is required, but no 2FA session token was provided by the server.");
        }
        setTwoFactorToken(data.two_factor_token);
        setPhase("2fa");
        return;
      }
      
      const accessToken = data.access_token || data.token;
      console.log("[PurveX] Access token received:", !!accessToken);

      try {
        if (typeof window !== "undefined") {
          const isProduction = process.env.NODE_ENV === "production";
          console.log("[PurveX] Setting localStorage items...");
            window.localStorage.setItem("purvex_username", username);
            if (!isProduction && accessToken) {
              console.log("[PurveX] Access token received (stored in httpOnly cookie).");
            }
          
          console.log("[PurveX] Session stored, redirecting to dashboard...");
        }
      } catch (storageErr) {
        console.error("[PurveX] Failed to cache session hint", storageErr);
      }

      // Use hard redirect to ensure it works reliably
      if (typeof window !== "undefined") {
        console.log("[PurveX] Redirecting to dashboard in 100ms...");
        // Small delay to ensure localStorage is set
      setTimeout(() => {
          console.log("[PurveX] Executing redirect to /dashboard");
          window.location.href = "/dashboard";
        }, 100);
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      console.error("[PurveX] Login failed", err);
      const isNetworkFailure = err.message === "Failed to fetch" || err.name === "TypeError";

      let errorMessage = "Login failed";
      if (isNetworkFailure) {
        errorMessage = `Cannot connect to backend API at ${API_URL}. Please ensure the backend server is running on port 8001. Check the browser console (F12) for more details.`;
        console.error("[PurveX] Network failure details:", {
          API_URL,
          candidates: typeof window !== "undefined" ? getApiBaseCandidates() : [],
          error: err.message,
          name: err.name,
          stack: err.stack,
        });
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage.replace(/email/gi, "username"));
        setPhase("idle");
    }
  }

  const reason = searchParams?.get("reason");
  const showExpiredBanner = reason === "expired";

  function handle2FASuccess(result: { verified: boolean; method: string; access_token?: string }) {
    try {
      if (!result.verified) {
        setError("2FA verification failed");
        setPhase("idle");
        return;
      }

      if (typeof window !== "undefined") {
        const isProduction = process.env.NODE_ENV === "production";
        window.localStorage.setItem("purvex_username", username);
          if (!isProduction && result.access_token) {
            console.log("[PurveX] 2FA access token received (stored in httpOnly cookie).");
          }

        window.location.href = "/dashboard";
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError(err.message || "2FA verification failed");
      setPhase("idle");
    }
  }

  return (
    <div
      className="min-h-screen text-white relative flex items-center justify-center px-4 py-8 overflow-hidden"
      style={{
        background: "radial-gradient(ellipse at top, rgba(59, 130, 246, 0.15), transparent 50%), radial-gradient(ellipse at bottom, rgba(139, 92, 246, 0.15), transparent 50%), linear-gradient(180deg, #0a0f1e 0%, #0d152f 50%, #0a0f1e 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.12] animate-pulse"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)",
            backgroundSize: "50px 50px",
          }}
        />
        {/* Floating gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse [animation-delay:2s]" />
      </div>

      <div className="relative z-10 w-full max-w-[540px] animate-in fade-in duration-700">
        <div className="px-4 py-6">
          {/* Enhanced glassmorphism card with glow */}
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600/25 via-purple-600/25 to-blue-600/25 rounded-[32px] blur opacity-80 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-pulse" />
            <div className="relative rounded-[32px] bg-gradient-to-br from-white/10 via-white/5 to-white/0 backdrop-blur-2xl border border-white/20 shadow-[0_24px_80px_rgba(15,23,42,0.85)] overflow-hidden">
              <div className="relative rounded-[30px] flex flex-col lg:flex-row min-h-[580px]">
                <div className="hidden lg:flex lg:w-7/12 flex-col justify-between border-r border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900/40 to-slate-900/10 px-10 py-10">
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/40 to-purple-500/40 rounded-2xl blur-xl" />
                        <div className="relative h-12 w-12 rounded-2xl bg-slate-900/80 border border-white/20 flex items-center justify-center shadow-[0_12px_40px_rgba(0,0,0,0.7)]">
                          <Image src="/logo.png" alt="PurveX Logo" width={32} height={32} className="drop-shadow-lg" />
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs uppercase tracking-[0.2em] text-slate-400">PurveX Security Cloud</span>
                        <span className="text-sm text-slate-300">Enterprise-grade monitoring, simplified.</span>
                      </div>
                    </div>

                    <div>
                      <h1 className="text-[30px] leading-tight font-semibold bg-gradient-to-br from-white via-blue-100 to-slate-100 bg-clip-text text-transparent">
                        See every signal.<br />Trust every session.
                      </h1>
                      <p className="mt-3 text-sm text-slate-300/80 max-w-sm">
                        Unified visibility across your entire environment, with real-time anomaly detection and actionable insights in one secure dashboard.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 shadow-sm flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                          Zero Trust Sessions
                        </div>
                        <div className="text-lg font-semibold text-slate-50">99.99%</div>
                        <div className="text-[10px] text-emerald-300/80">Policy-compliant access uptime</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 shadow-sm flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <LockKeyhole className="h-3.5 w-3.5 text-sky-400" />
                          Events Correlated
                        </div>
                        <div className="text-lg font-semibold text-slate-50">12.4M</div>
                        <div className="text-[10px] text-sky-300/80">Signals processed last 24 hours</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between text-[11px] text-slate-400/90">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span>SSO · MFA · Audit trails</span>
                    </div>
                    <span className="text-slate-500/90">SOC2-ready by design</span>
                  </div>
                </div>

                <div className="flex-1 w-full flex flex-col items-center justify-center px-8 py-8 lg:px-10 lg:py-10 bg-gradient-to-br from-slate-950/60 via-slate-900/60 to-slate-900/30">
                  <div className="flex flex-col items-center text-center space-y-3 mb-4 lg:hidden">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/25 to-purple-500/25 rounded-3xl blur-xl" />
                      <div className="relative h-16 w-16 rounded-3xl bg-gradient-to-br from-white/20 to-white/5 border border-white/30 flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-sm">
                        <Image src="/logo.png" alt="PurveX Logo" width={40} height={40} className="drop-shadow-lg" />
                      </div>
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold text-white tracking-tight">Welcome back</h2>
                      <p className="text-xs text-slate-400 mt-1.5">Secure access to your PurveX workspace</p>
                    </div>
                  </div>

                  <div className="flex-1 w-full flex flex-col items-center justify-center space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
                  {phase === "2fa" && twoFactorToken ? (
                    <TwoFactorVerify
                      twoFactorToken={twoFactorToken}
                      onSuccess={handle2FASuccess}
                      onCancel={() => {
                        setPhase("idle");
                        setError(null);
                      }}
                    />
                  ) : (
                    <div className="w-full flex flex-col flex-1 items-center gap-5 max-w-md">
                      {showExpiredBanner && !error && (
                        <div className="w-full text-sm text-sky-100 bg-gradient-to-r from-sky-900/60 to-blue-900/60 border border-sky-500/50 rounded-xl px-4 py-3 backdrop-blur-sm shadow-lg animate-in slide-in-from-top-2 duration-300" role="status">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-sky-300 flex-shrink-0" />
                            <span>Your session expired. Please sign in again to continue.</span>
                          </div>
                        </div>
                      )}

                      {error && (
                        <div className="w-full text-sm text-red-100 bg-gradient-to-r from-red-900/60 to-rose-900/60 border border-red-500/50 rounded-xl px-4 py-3 backdrop-blur-sm shadow-lg animate-in slide-in-from-top-2 duration-300" role="alert">
                          <div className="flex items-start gap-2.5">
                            <AlertCircle className="h-4 w-4 mt-0.5 text-red-300 flex-shrink-0" />
                            <span className="flex-1 leading-relaxed">{error}</span>
                          </div>
                        </div>
                      )}

                      <form
                        onSubmit={(e) => {
                          handleSubmit(e);
                        }}
                        className="space-y-4 w-full"
                        aria-label="PurveX sign in"
                        aria-busy={phase === "auth"}
                        noValidate
                      >
                        <div className="space-y-2">
                          <label htmlFor="username" className="block text-sm font-medium text-slate-200 flex items-center gap-2">
                            Username
                          </label>
                          <div className="relative group/input">
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-purple-500/0 to-blue-500/0 rounded-2xl blur-sm group-hover/input:from-blue-500/10 group-hover/input:via-purple-500/10 group-hover/input:to-blue-500/10 transition-all duration-300" />
                            <input
                              id="username"
                              type="text"
                              className="relative w-full rounded-2xl bg-white/5 backdrop-blur-sm text-slate-50 pl-12 pr-4 py-3.5 text-sm placeholder:text-slate-500 border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-200 shadow-lg hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                              autoComplete="username"
                              placeholder="Enter your username"
                              value={username}
                              onChange={(e) => setUsername(e.target.value)}
                              required
                              disabled={phase === "auth"}
                            />
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label htmlFor="password" className="block text-sm font-medium text-slate-200 flex items-center gap-2">
                            <Lock className="h-3.5 w-3.5 text-slate-400" />
                            Password
                          </label>
                          <div className="relative group/input">
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-purple-500/0 to-blue-500/0 rounded-2xl blur-sm group-hover/input:from-blue-500/10 group-hover/input:via-purple-500/10 group-hover/input:to-blue-500/10 transition-all duration-300" />
                            <input
                              id="password"
                              type={showPassword ? "text" : "password"}
                              className="relative w-full rounded-2xl bg-white/5 backdrop-blur-sm text-slate-50 pl-12 pr-12 py-3.5 text-sm placeholder:text-slate-500 border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-200 shadow-lg hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                              autoComplete="current-password"
                              placeholder="Enter your password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              required
                              disabled={phase === "auth"}
                            />
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-white/90 transition-colors duration-200"
                              aria-label={showPassword ? "Hide password" : "Show password"}
                              tabIndex={-1}
                            >
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none group/checkbox">
                            <input
                              type="checkbox"
                              checked={rememberMe}
                              onChange={() => setRememberMe((v) => !v)}
                              className="h-4 w-4 rounded border-2 border-white/30 bg-white/5 text-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none transition-all duration-200 cursor-pointer group-hover/checkbox:border-white/50"
                            />
                            <span className="text-sm text-slate-300 group-hover/checkbox:text-white transition-colors">Keep me signed in</span>
                          </label>
                        </div>

                        <button
                          type="submit"
                          disabled={phase === "auth"}
                          className="relative w-full rounded-2xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white py-4 px-6 text-sm font-semibold hover:from-blue-500 hover:via-blue-400 hover:to-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-300 shadow-[0_8px_30px_rgba(59,130,246,0.4)] hover:shadow-[0_12px_40px_rgba(59,130,246,0.5)] hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2.5 group"
                        >
                          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-white/0 via-white/20 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                          {phase === "auth" ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin relative z-10" />
                              <span className="relative z-10">Signing in...</span>
                            </>
                          ) : (
                            <>
                              <Shield className="h-4 w-4 relative z-10" />
                              <span className="relative z-10">Sign in</span>
                            </>
                          )}
                        </button>

                      </form>

                      <div className="mt-6 pt-6 border-t border-white/10 w-full">
                        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                          <ShieldCheck className="h-3 w-3" />
                          <span>Encrypted in transit and at rest</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
