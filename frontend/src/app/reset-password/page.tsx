"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { getApiBaseCandidates } from "@/lib/api";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { FieldError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";

const PRIMARY_BUTTON_CLASSNAME =
  "border border-primary bg-primary text-primary-foreground hover:bg-primary/90";

const FIELD_LABEL_CLASSNAME =
  "mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80";

const FIELD_CLASSNAME =
  "h-12 rounded-[10px] border border-black/[0.08] bg-black/[0.015] pl-11 text-base shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-150 placeholder:text-muted-foreground/50 hover:border-black/[0.14] focus-visible:border-primary/60 focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:shadow-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:focus-visible:border-primary/50";

// Mirrors backend/app/security.py:validate_password_complexity exactly, so
// the client catches the same failures before hitting the API.
const passwordSchema = z
  .string()
  .min(8, "At least 8 characters.")
  .regex(/[a-z]/, "One lowercase letter.")
  .regex(/[A-Z]/, "One uppercase letter.")
  .regex(/\d/, "One number.")
  .regex(/[!@#$%^&*(),.?":{}|<>[\]\\/_+=~`-]/, "One special character.");

type FieldErrors = Partial<Record<"password" | "confirm", string>>;

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function fetchWithApiFallback(path: string, init: RequestInit): Promise<Response> {
    let lastError: unknown = null;
    for (const base of getApiBaseCandidates()) {
      try {
        return await fetch(`${base}${path}`, init);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Unable to reach backend API.");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("This reset link is invalid or missing a token. Request a new one.");
      return;
    }

    const parsed = passwordSchema.safeParse(password);
    const nextErrors: FieldErrors = {};
    if (!parsed.success) nextErrors.password = parsed.error.issues[0]?.message;
    if (confirm !== password) nextErrors.confirm = "Passwords don't match.";
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setError(null);
    setPhase("submitting");

    try {
      const res = await fetchWithApiFallback("/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
        credentials: "include",
        mode: "cors",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || `Reset failed (${res.status})`);
      }
      setPhase("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to reset your password. The link may have expired.");
      setPhase("idle");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[440px]">
          {phase === "done" ? (
            <div className="text-center">
              <Image src="/logo.png" alt="PurveX" width={40} height={40} className="mx-auto mb-4 rounded-md" />
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)]">
                <CheckCircle2 className="h-6 w-6 text-[var(--accent-strong)]" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">Password reset</h1>
              <p className="mt-2 text-base text-muted-foreground">
                Your password has been updated. Sign in with your new password.
              </p>
              <Link
                href="/login"
                className={`mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-lg px-6 text-base font-medium transition ${PRIMARY_BUTTON_CLASSNAME}`}
              >
                Sign in
              </Link>
            </div>
          ) : !token ? (
            <div className="text-center">
              <Image src="/logo.png" alt="PurveX" width={40} height={40} className="mx-auto mb-4 rounded-md" />
              <h1 className="text-2xl font-semibold tracking-tight">Invalid reset link</h1>
              <p className="mt-2 text-base text-muted-foreground">
                This link is missing its token. Request a new reset link and try again.
              </p>
              <Link
                href="/forgot-password"
                className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-strong)] transition hover:opacity-80"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-10 flex flex-col items-center text-center">
                <Image src="/logo.png" alt="PurveX" width={40} height={40} className="mb-4 rounded-md" />
                <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
                <p className="mt-2 text-base text-muted-foreground">
                  At least 8 characters, with upper and lower case, a number, and a special character.
                </p>
              </div>

              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <div>
                  <label htmlFor="password" className={FIELD_LABEL_CLASSNAME}>
                    New password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      autoFocus
                      placeholder="••••••••••"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                      }}
                      disabled={phase === "submitting"}
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby="password-error"
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
                  <FieldError id="password-error" message={fieldErrors.password} />
                </div>

                <div>
                  <label htmlFor="confirm" className={FIELD_LABEL_CLASSNAME}>
                    Confirm password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                      id="confirm"
                      name="confirm"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="••••••••••"
                      value={confirm}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        if (fieldErrors.confirm) setFieldErrors((prev) => ({ ...prev, confirm: undefined }));
                      }}
                      disabled={phase === "submitting"}
                      aria-invalid={!!fieldErrors.confirm}
                      aria-describedby="confirm-error"
                      className={FIELD_CLASSNAME}
                    />
                  </div>
                  <FieldError id="confirm-error" message={fieldErrors.confirm} />
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/20 dark:bg-red-500/[0.08]">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                    <p className="text-xs leading-relaxed text-red-800 dark:text-red-200">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={phase === "submitting"}
                  className={`flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${PRIMARY_BUTTON_CLASSNAME}`}
                >
                  {phase === "submitting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Resetting
                    </>
                  ) : (
                    "Reset password"
                  )}
                </button>
              </form>

              <Link
                href="/login"
                className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
              >
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>

      <p className="pb-6 text-center text-[11px] text-muted-foreground">
        &copy; {new Date().getFullYear()} PurveX
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
