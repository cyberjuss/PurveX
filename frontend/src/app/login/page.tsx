"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import TwoFactorVerify from "@/components/auth/TwoFactorVerify";
import { getApiBaseCandidates, getBootstrapStatus } from "@/lib/api";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, RefreshCw, ShieldCheck, Zap, Lock } from "lucide-react";

const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;
const LOCKOUT_MAX_ATTEMPTS = 5;

type ErrorKind = "network" | "auth" | "session" | "generic";

async function checkBackendHealthWithFallback(apiBases: string[]): Promise<boolean> {
  for (const base of apiBases) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>("generic");
  const [phase, setPhase] = useState<"idle" | "auth" | "2fa">("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [pendingFirstLogin, setPendingFirstLogin] = useState<boolean | null>(null);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");

  const getApiBases = () =>
    typeof window !== "undefined"
      ? getApiBaseCandidates()
      : [process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001"];

  async function fetchWithApiFallback(path: string, init: RequestInit): Promise<Response> {
    let lastError: unknown = null;
    for (const base of getApiBases()) {
      try {
        return await fetch(`${base}${path}`, init);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Unable to reach backend API.");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await checkBackendHealthWithFallback(getApiBases());
      if (!cancelled) setBackendStatus(ok ? "online" : "offline");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsReturning(window.localStorage.getItem("purvex_seen_login") === "1");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getBootstrapStatus();
        if (!cancelled && status.needs_admin) router.replace("/setup");
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const raw = window.localStorage.getItem("purvex_login_failures") || "[]";
    const entries: number[] = JSON.parse(raw).filter((ts: number) => now - ts < LOCKOUT_WINDOW_MS);
    if (entries.length) window.localStorage.setItem("purvex_login_failures", JSON.stringify(entries));
    const storedLockout = window.localStorage.getItem("purvex_login_lockout_until");
    const until = storedLockout ? Number(storedLockout) : null;
    if (until && !Number.isNaN(until) && now < until) {
      setLockoutUntil(until);
      return;
    }
    if (storedLockout) window.localStorage.removeItem("purvex_login_lockout_until");
    setLockoutUntil(null);
  }, []);

  const handleCapsLockCheck = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const capsLock = e.getModifierState?.("CapsLock");
    if (typeof capsLock === "boolean") setCapsLockOn(capsLock);
  };

  const registerLoginFailure = () => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const raw = window.localStorage.getItem("purvex_login_failures") || "[]";
    const entries: number[] = JSON.parse(raw).filter((ts: number) => now - ts < LOCKOUT_WINDOW_MS);
    entries.push(now);
    window.localStorage.setItem("purvex_login_failures", JSON.stringify(entries));
    if (entries.length >= LOCKOUT_MAX_ATTEMPTS) {
      const until = now + LOCKOUT_DURATION_MS;
      window.localStorage.setItem("purvex_login_lockout_until", String(until));
      setLockoutUntil(until);
    }
  };

  function setErrorState(msg: string, kind: ErrorKind = "generic") {
    setError(msg);
    setErrorKind(kind);
  }

  async function handleRetryConnection() {
    setBackendStatus("checking");
    setError(null);
    const ok = await checkBackendHealthWithFallback(getApiBases());
    setBackendStatus(ok ? "online" : "offline");
    if (!ok) setErrorState("Still unable to reach the backend server.", "network");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const submittedUsername = String(formData.get("username") || "").trim();
    const submittedPassword = String(formData.get("password") || "");
    if (lockoutUntil && Date.now() < lockoutUntil) {
      setErrorState("Too many login attempts. Please wait 5 minutes.", "auth");
      return;
    }
    if (!submittedUsername || !submittedPassword) {
      setErrorState("Please enter both username and password.", "auth");
      return;
    }
    setUsername(submittedUsername);
    setPassword(submittedPassword);
    setError(null);
    setPhase("auth");

    try {
      const form = new URLSearchParams();
      form.append("username", submittedUsername);
      form.append("password", submittedPassword);
      const res = await fetchWithApiFallback("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        credentials: "include",
        mode: "cors",
      });

      if (!res.ok) {
        let msg = `Login failed (${res.status})`;
        const contentType = res.headers.get("content-type") || "";
        if (res.headers.get("content-length") === "0") {
          msg = `Empty server response (${res.status})`;
        } else if (contentType.includes("application/json")) {
          try {
            const data = await res.json();
            msg = data?.detail || data?.message || msg;
          } catch {}
        } else {
          try {
            const text = await res.text();
            if (text) msg = text;
          } catch {}
        }
        throw new Error(msg);
      }

      const data = await res.json().catch(() => ({}));
      if (data.requires_2fa) {
        if (!data.two_factor_token) throw new Error("2FA required but no session token provided.");
        if (typeof data.is_first_login === "boolean") setPendingFirstLogin(data.is_first_login);
        setTwoFactorToken(data.two_factor_token);
        setPhase("2fa");
        return;
      }

      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("purvex_username", submittedUsername);
          window.localStorage.removeItem("purvex_access_token");
          window.localStorage.removeItem("purvex_login_failures");
          window.localStorage.removeItem("purvex_login_lockout_until");
          setLockoutUntil(null);
          window.localStorage.setItem(
            "purvex_seen_login",
            typeof data.is_first_login === "boolean" ? (data.is_first_login ? "0" : "1") : "1",
          );
        }
      } catch {}

      if (typeof window !== "undefined") window.location.assign("/dashboard");
      else router.push("/dashboard");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      const name = err instanceof Error ? err.name : "";
      registerLoginFailure();
      if (message === "Failed to fetch" || name === "TypeError") {
        setBackendStatus("offline");
        setErrorState("Cannot connect to the backend server. Ensure it is running and try again.", "network");
      } else if (message) {
        setErrorState(message.replace(/email/gi, "username"), "auth");
      } else {
        setErrorState("An unexpected error occurred.", "generic");
      }
      setPhase("idle");
    }
  }

  const showExpiredBanner = searchParams?.get("reason") === "expired";

  function handle2FASuccess(result: { verified: boolean; method: string }) {
    if (!result.verified) {
      setErrorState("2FA verification failed.", "auth");
      setPhase("idle");
      return;
    }
    const finalizeRedirect = async () => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("purvex_username", username);
        window.localStorage.removeItem("purvex_access_token");
        window.localStorage.setItem(
          "purvex_seen_login",
          pendingFirstLogin !== null ? (pendingFirstLogin ? "0" : "1") : "1",
        );
        window.location.href = "/dashboard";
      } else {
        router.push("/dashboard");
      }
    };
    void finalizeRedirect();
  }

  const isLocked = !!(lockoutUntil && Date.now() < lockoutUntil);

  return (
    <div className="relative grid min-h-screen grid-cols-1 bg-white lg:grid-cols-2">
      {/* LEFT — brand showcase */}
      <div className="relative hidden overflow-hidden bg-slate-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Aurora glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 30% 20%, rgba(34,211,238,0.22) 0%, transparent 60%), radial-gradient(ellipse 50% 50% at 80% 80%, rgba(129,140,248,0.20) 0%, transparent 60%)",
          }}
        />
        {/* Grid overlay */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, #000 30%, transparent 90%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, #000 30%, transparent 90%)",
          }}
        />

          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10 backdrop-blur">
              <Image src="/logo.png" alt="PurveX" width={28} height={28} className="h-7 w-7 object-contain" />
            </div>
            <span className="text-[17px] font-semibold tracking-tight text-white">PurveX</span>
          </div>

        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-white">
            Red meets blue.{" "}
            <span className="bg-gradient-to-r from-cyan-300 to-indigo-300 bg-clip-text text-transparent">
              In one workspace.
            </span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-400">
            Test detections. Measure coverage. Ship fixes faster.
          </p>

          <ul className="mt-8 space-y-3.5">
            {[
              { icon: ShieldCheck, text: "Track detection lifecycle & coverage" },
              { icon: Zap, text: "Run Atomic tests with live telemetry" },
              { icon: Lock, text: "Audit-ready logs, 2FA built in" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                  <Icon className="h-3.5 w-3.5 text-cyan-300" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-slate-500">
          © {new Date().getFullYear()} PurveX. All rights reserved.
        </p>
      </div>

      {/* RIGHT — form */}
      <div className="relative flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          {/* Mobile brand header */}
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 ring-1 ring-slate-900">
                <Image src="/logo.png" alt="PurveX" width={28} height={28} className="h-7 w-7 object-contain" />
              </div>
              <span className="text-[17px] font-semibold tracking-tight text-slate-950">PurveX</span>
            </div>

          <div className="mb-8">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-slate-950">
              {isReturning ? "Sign in" : "Sign in"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {isReturning
                ? "Enter your credentials to access your workspace."
                : "Access your PurveX workspace with your username and password."}
            </p>
          </div>

          {showExpiredBanner && !error && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              Session expired. Please sign in again.
            </div>
          )}

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
            <form onSubmit={handleSubmit} noValidate>
              <div className="mb-4">
                <label htmlFor="username" className="mb-1.5 block text-xs font-medium text-slate-600">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  placeholder="you@company.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={phase === "auth" || isLocked}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3.5 text-sm text-slate-950 placeholder:text-slate-400 focus:border-cyan-400/50 focus:bg-white focus:ring-2 focus:ring-cyan-400/15 focus:outline-none disabled:opacity-40"
                />
              </div>

              <div className="mb-5">
                <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-slate-600">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleCapsLockCheck}
                    onKeyUp={handleCapsLockCheck}
                    disabled={phase === "auth" || isLocked}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3.5 pr-10 text-sm text-slate-950 placeholder:text-slate-400 focus:border-cyan-400/50 focus:bg-white focus:ring-2 focus:ring-cyan-400/15 focus:outline-none disabled:opacity-40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition hover:text-cyan-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
                {capsLockOn && <p className="mt-1.5 text-xs text-amber-700">Caps Lock is on</p>}
              </div>

              {error && (
                <div
                  className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 ${
                    errorKind === "network"
                      ? "border-amber-500/20 bg-amber-500/[0.05]"
                      : errorKind === "session"
                        ? "border-blue-500/20 bg-blue-500/[0.05]"
                        : "border-red-500/20 bg-red-500/[0.05]"
                  }`}
                  role="alert"
                >
                  <AlertCircle
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      errorKind === "network"
                        ? "text-amber-400/70"
                        : errorKind === "session"
                          ? "text-blue-400/70"
                          : "text-red-400/70"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs leading-relaxed ${
                        errorKind === "network"
                          ? "text-amber-900"
                          : errorKind === "session"
                            ? "text-blue-900"
                            : "text-red-900"
                      }`}
                    >
                      {error}
                    </p>
                    {errorKind === "network" && (
                      <button
                        type="button"
                        onClick={handleRetryConnection}
                        className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700 transition hover:text-amber-900"
                      >
                        <RefreshCw className={`h-3 w-3 ${backendStatus === "checking" ? "animate-spin" : ""}`} />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={phase === "auth" || isLocked}
                className="group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-black bg-black text-sm font-semibold text-white transition hover:bg-white hover:text-black hover:shadow-[0_14px_30px_-18px_rgba(15,23,42,0.25)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 bg-[linear-gradient(120deg,transparent_20%,rgba(255,255,255,0.12)_50%,transparent_80%)] opacity-0 transition duration-500 group-hover:opacity-100"
                />
                {phase === "auth" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Authenticating
                  </>
                ) : isLocked ? (
                  "Locked — try again later"
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                backendStatus === "online"
                  ? "bg-emerald-400"
                  : backendStatus === "offline"
                    ? "bg-red-400"
                    : "animate-pulse bg-slate-500"
              }`}
            />
            {backendStatus === "online"
              ? "Secure connection"
              : backendStatus === "offline"
                ? "Server offline"
                : "Connecting"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#05070d]" />}>
      <LoginPageContent />
    </Suspense>
  );
}
