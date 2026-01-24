"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { getApiBaseCandidates } from "@/lib/api";
import TwoFactorVerify from "@/components/auth/TwoFactorVerify";
import { Loader2, Shield, AlertCircle, User, Lock, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "auth" | "2fa">("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [pendingFirstLogin, setPendingFirstLogin] = useState<boolean | null>(null);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);

  const lockoutWindowMs = 10 * 60 * 1000;
  const lockoutDurationMs = 5 * 60 * 1000;
  const lockoutMaxAttempts = 5;

  const API_URL =
    typeof window !== "undefined"
      ? getApiBaseCandidates()[0] || "http://127.0.0.1:8001"
      : process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
  
  // Log API URL for debugging
  if (typeof window !== "undefined") {
    console.log("[PurveX] API URL candidates:", getApiBaseCandidates());
    console.log("[PurveX] Using API URL:", API_URL);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = window.localStorage.getItem("purvex_seen_login") === "1";
    setIsReturning(seen);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const raw = window.localStorage.getItem("purvex_login_failures") || "[]";
    const entries: number[] = JSON.parse(raw).filter((ts: number) => now - ts < lockoutWindowMs);
    if (entries.length) {
      window.localStorage.setItem("purvex_login_failures", JSON.stringify(entries));
    }

    const storedLockout = window.localStorage.getItem("purvex_login_lockout_until");
    const until = storedLockout ? Number(storedLockout) : null;
    if (until && !Number.isNaN(until) && now < until) {
      setLockoutUntil(until);
      return;
    }

    if (storedLockout) {
      window.localStorage.removeItem("purvex_login_lockout_until");
    }
    setLockoutUntil(null);
  }, []);

  const handleCapsLockCheck = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const capsLock = event.getModifierState?.("CapsLock");
    if (typeof capsLock === "boolean") {
      setCapsLockOn(capsLock);
    }
  };

  const registerLoginFailure = () => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const raw = window.localStorage.getItem("purvex_login_failures") || "[]";
    const entries: number[] = JSON.parse(raw).filter((ts: number) => now - ts < lockoutWindowMs);
    entries.push(now);
    window.localStorage.setItem("purvex_login_failures", JSON.stringify(entries));

    if (entries.length >= lockoutMaxAttempts) {
      const until = now + lockoutDurationMs;
      window.localStorage.setItem("purvex_login_lockout_until", String(until));
      setLockoutUntil(until);
      return;
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();

    console.log("[PurveX] Form submitted", { username, hasPassword: !!password });

    if (lockoutUntil && Date.now() < lockoutUntil) {
      setError("Too many login attempts. Please wait 5 minutes and try again.");
      return;
    }

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
        let errorMessage = `Login failed with status ${res.status}`;
        const contentType = res.headers.get("content-type") || "";
        const contentLength = res.headers.get("content-length");

        if (contentLength === "0") {
          errorMessage = `Login failed with status ${res.status}: empty response`;
        } else if (contentType.includes("application/json")) {
          try {
            const data = await res.json();
            if (data && Object.keys(data).length > 0) {
              console.error("[PurveX] Login failed:", data);
            }
            errorMessage = data?.detail || data?.message || errorMessage;
          } catch (parseError) {
            console.error("[PurveX] Login failed (invalid JSON):", parseError);
          }
        } else {
          try {
            const text = await res.text();
            if (text) {
              console.error("[PurveX] Login failed (non-JSON):", text);
              errorMessage = text;
            }
          } catch (textError) {
            console.error("[PurveX] Login failed (could not read response):", textError);
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
        if (typeof data.is_first_login === "boolean") {
          setPendingFirstLogin(data.is_first_login);
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
            if (accessToken) {
              window.localStorage.setItem("purvex_access_token", accessToken);
            }
            window.localStorage.removeItem("purvex_login_failures");
            window.localStorage.removeItem("purvex_login_lockout_until");
            setLockoutUntil(null);
          if (typeof data.is_first_login === "boolean") {
            window.localStorage.setItem("purvex_seen_login", data.is_first_login ? "0" : "1");
          } else {
            window.localStorage.setItem("purvex_seen_login", "1");
          }
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
      registerLoginFailure();
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
        if (result.access_token) {
          window.localStorage.setItem("purvex_access_token", result.access_token);
        }
        if (pendingFirstLogin !== null) {
          window.localStorage.setItem("purvex_seen_login", pendingFirstLogin ? "0" : "1");
        } else {
          window.localStorage.setItem("purvex_seen_login", "1");
        }
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
      className="min-h-screen text-white relative flex items-center justify-center px-4 py-8"
      style={{
        backgroundImage:
          "radial-gradient(circle at top, rgba(13,28,70,0.85), transparent 55%), linear-gradient(180deg, #040918 0%, #050b1d 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[420px]">
        <div className="px-4 py-6">
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/80 to-slate-950 p-[1px] shadow-[0_30px_60px_rgba(2,7,32,0.55)]">
            <div
              className="relative w-full rounded-xl border border-white/10 bg-slate-950/80 backdrop-blur-[12px] flex flex-col overflow-hidden py-8 transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[0_36px_70px_rgba(2,7,32,0.55)] active:translate-y-0 active:shadow-[0_26px_50px_rgba(2,7,32,0.45)]"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 20% 15%, rgba(96,165,250,0.25), transparent 55%), radial-gradient(circle at 80% 10%, rgba(59,130,246,0.15), transparent 50%)",
              }}
            >
              <div className="flex flex-col items-center text-center space-y-3 px-8 pb-2 mt-2">
                <div className="relative h-28 w-28 rounded-2xl bg-white border border-white/20 flex items-center justify-center shadow-[0_12px_44px_rgba(5,8,20,0.5)]">
                  <div
                    className="absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] pointer-events-none"
                    aria-hidden="true"
                  />
                  <Image src="/logo.png" alt="PurveX Logo" width={72} height={72} />
                </div>
                <div className="space-y-0.5">
                  <h1 className="text-4xl font-semibold text-white tracking-tight">
                    {isReturning ? "Welcome back" : "Welcome"}
                  </h1>
                  <p className="text-sm text-white/70">Sign in to continue to your workspace.</p>
                </div>
              </div>

              <div className="w-full px-8 pb-6 flex items-center justify-center -mt-2">
                {phase === "2fa" && twoFactorToken ? (
                  <div className="w-full flex items-center justify-center">
                    <TwoFactorVerify
                      twoFactorToken={twoFactorToken}
                      onSuccess={handle2FASuccess}
                      onCancel={() => {
                        setPhase("idle");
                        setError(null);
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 w-full text-sm">
                    <div className="flex flex-col items-center gap-2 w-full"></div>

                    <form
                      onSubmit={handleSubmit}
                      className="flex flex-col gap-4 w-full mt-3"
                      aria-label="PurveX sign in"
                      aria-busy={phase === "auth"}
                      noValidate
                    >
                      <div className="space-y-1 text-white/70">
                        <label htmlFor="username" className="block text-sm font-semibold text-white/70">
                          Username
                        </label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-white/70" />
                          <input
                            id="username"
                            type="text"
                            className="w-full rounded-xl bg-white/10 text-white/70 pl-9 pr-3 py-2 text-sm placeholder:text-white/70 focus:outline-none focus:ring-2 focus:ring-sky-400/50 transition shadow-[0_8px_30px_rgba(5,10,25,0.35)] disabled:opacity-100 disabled:text-white/70"
                            autoComplete="username"
                            placeholder="Enter your username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            disabled={phase === "auth"}
                          />
                        </div>
                      </div>

                      <div className="space-y-1 text-white/70">
                        <label htmlFor="password" className="block text-sm font-semibold text-white/70">
                          Password
                        </label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-white/70" />
                          <input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            className="w-full rounded-xl bg-white/10 text-white/70 pl-9 pr-10 py-2 text-sm placeholder:text-white/70 focus:outline-none focus:ring-2 focus:ring-sky-400/50 transition shadow-[0_8px_30px_rgba(5,10,25,0.35)] disabled:opacity-100 disabled:text-white/70"
                            autoComplete="current-password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={handleCapsLockCheck}
                            onKeyUp={handleCapsLockCheck}
                            required
                            disabled={phase === "auth"}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/70 hover:text-white transition"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            tabIndex={-1}
                          >
                            {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                        </div>
                        {capsLockOn && (
                          <div className="mt-2.5 text-sm text-white/70">
                            Caps Lock is on.
                          </div>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={phase === "auth"}
                        className="w-full rounded-2xl bg-gradient-to-r from-slate-100 via-white to-slate-100 text-[#0d152f] py-3 text-sm font-semibold flex items-center justify-center gap-2 transition shadow-[0_20px_40px_rgba(2,9,30,0.35)] cursor-pointer hover:cursor-pointer disabled:opacity-100 disabled:cursor-not-allowed mt-5"
                      >
                        {phase === "auth" ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-[#0d152f]" />
                            <span>Signing in...</span>
                          </>
                        ) : (
                          <>
                            <Shield className="h-6 w-6" />
                            <span>Sign in</span>
                          </>
                          )}
                        </button>

                      <div className="flex flex-col items-center gap-1.5 mt-6 text-white/70">
                        {showExpiredBanner && !error && (
                          <div className="text-sm text-white/70 px-1 text-center" role="status">
                            Your session expired. Please sign in again.
                          </div>
                        )}
                        {error && (
                          <div className="text-sm text-white/70 w-full flex items-center justify-center" role="alert">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-white/70" />
                              <span className="leading-relaxed">{error}</span>
                            </div>
                          </div>
                        )}

                      </div>
                    </form>

                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
