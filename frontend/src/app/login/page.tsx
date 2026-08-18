"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { getApiBaseCandidates, getBootstrapStatus } from "@/lib/api";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, RefreshCw, User } from "lucide-react";
import { FieldError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";

const PRIMARY_BUTTON_CLASSNAME =
  "border border-primary bg-primary text-primary-foreground hover:bg-primary/90";

const FIELD_LABEL_CLASSNAME =
  "mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80";

const FIELD_CLASSNAME =
  "h-12 rounded-[10px] border border-black/[0.08] bg-black/[0.015] pl-11 text-base shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-150 placeholder:text-muted-foreground/50 hover:border-black/[0.14] focus-visible:border-primary/60 focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:shadow-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:focus-visible:border-primary/50";

// Login accepts whatever the backend will accept (existing accounts may pre-date
// our current username policy), so we only enforce "not empty" here and let the
// server reject malformed input.
const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

type LoginFieldErrors = Partial<Record<"username" | "password", string>>;

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
  const [phase, setPhase] = useState<"idle" | "auth">("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});

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

  const handleCapsLockCheck = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const capsLock = e.getModifierState?.("CapsLock");
    if (typeof capsLock === "boolean") setCapsLockOn(capsLock);
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

    const parsed = loginSchema.safeParse({
      username: submittedUsername,
      password: submittedPassword,
    });
    if (!parsed.success) {
      const nextErrors: LoginFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "username" || key === "password") {
          if (!nextErrors[key]) nextErrors[key] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
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

      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("purvex_username", submittedUsername);
          window.localStorage.setItem(
            "purvex_seen_login",
            typeof data.is_first_login === "boolean" ? (data.is_first_login ? "0" : "1") : "1",
          );
        }
      } catch {}

      const destination = getPostLoginDestination();
      if (typeof window !== "undefined") window.location.assign(destination);
      else router.push(destination);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      const name = err instanceof Error ? err.name : "";
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

  function getPostLoginDestination(): string {
    const raw = searchParams?.get("next");
    if (!raw) return "/dashboard";
    try {
      const decoded = decodeURIComponent(raw);
      // Only allow same-origin relative paths. Disallow protocol-relative
      // (`//evil.com`) or absolute URLs to avoid open redirects.
      if (
        decoded.startsWith("/") &&
        !decoded.startsWith("//") &&
        !decoded.startsWith("/\\")
      ) {
        return decoded;
      }
    } catch {
      // fall through to default
    }
    return "/dashboard";
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-10 flex flex-col items-center text-center">
            <Image src="/logo.png" alt="PurveX" width={40} height={40} className="mb-4 rounded-md" />
            <h1 className="text-3xl font-semibold tracking-tight">
              {isReturning ? "Welcome back" : "Sign in"}
            </h1>
            <p className="mt-2 text-base text-muted-foreground">
              {isReturning ? "Get back to your detections." : "Access the PurveX workspace."}
            </p>
          </div>

          {showExpiredBanner && !error && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
              Session expired. Please sign in again.
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <label htmlFor="username" className={FIELD_LABEL_CLASSNAME}>
                  Username
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (fieldErrors.username) {
                        setFieldErrors((prev) => ({ ...prev, username: undefined }));
                      }
                    }}
                    disabled={phase === "auth"}
                    aria-invalid={!!fieldErrors.username}
                    aria-describedby="login-username-error"
                    className={FIELD_CLASSNAME}
                  />
                </div>
                <FieldError id="login-username-error" message={fieldErrors.username} />
              </div>

              <div>
                <label htmlFor="password" className={FIELD_LABEL_CLASSNAME}>
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) {
                        setFieldErrors((prev) => ({ ...prev, password: undefined }));
                      }
                    }}
                    onKeyDown={handleCapsLockCheck}
                    onKeyUp={handleCapsLockCheck}
                    disabled={phase === "auth"}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby="login-password-error"
                    className={`${FIELD_CLASSNAME} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-muted-foreground/60 transition hover:text-foreground"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
                <FieldError id="login-password-error" message={fieldErrors.password} />
                {capsLockOn && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">Caps Lock is on</p>}
              </div>

              {error && (
                <div
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${
                    errorKind === "network"
                      ? "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/[0.08]"
                      : errorKind === "session"
                        ? "border-blue-200 bg-blue-50 dark:border-blue-500/20 dark:bg-blue-500/[0.08]"
                        : "border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/[0.08]"
                  }`}
                  role="alert"
                >
                  <AlertCircle
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      errorKind === "network"
                        ? "text-amber-500"
                        : errorKind === "session"
                          ? "text-blue-500"
                          : "text-red-500"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs leading-relaxed ${
                        errorKind === "network"
                          ? "text-amber-800 dark:text-amber-200"
                          : errorKind === "session"
                            ? "text-blue-800 dark:text-blue-200"
                            : "text-red-800 dark:text-red-200"
                      }`}
                    >
                      {error}
                    </p>
                    {errorKind === "network" && (
                      <button
                        type="button"
                        onClick={handleRetryConnection}
                        className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700 transition hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
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
                disabled={phase === "auth"}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${PRIMARY_BUTTON_CLASSNAME}`}
              >
                {phase === "auth" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Authenticating
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                backendStatus === "online"
                  ? "bg-emerald-500"
                  : backendStatus === "offline"
                    ? "bg-red-500"
                    : "animate-pulse bg-slate-400"
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

      <p className="pb-6 text-center text-[11px] text-muted-foreground">
        &copy; {new Date().getFullYear()} PurveX
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginPageContent />
    </Suspense>
  );
}

