"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { z } from "zod";
import { getApiBaseCandidates } from "@/lib/api";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { FieldError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";

const PRIMARY_BUTTON_CLASSNAME =
  "border border-primary bg-primary text-primary-foreground hover:bg-primary/90";

const FIELD_LABEL_CLASSNAME =
  "mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80";

const FIELD_CLASSNAME =
  "h-12 rounded-[10px] border border-black/[0.08] bg-black/[0.015] pl-11 text-base shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-150 placeholder:text-muted-foreground/50 hover:border-black/[0.14] focus-visible:border-primary/60 focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:shadow-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:focus-visible:border-primary/50";

const emailSchema = z.string().trim().min(1, "Enter your email.").email("Enter a valid email address.");

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<"idle" | "submitting" | "sent">("idle");
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
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    setError(null);
    setPhase("submitting");

    try {
      const res = await fetchWithApiFallback("/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed.data }),
        credentials: "include",
        mode: "cors",
      });
      if (!res.ok && res.status !== 429) {
        throw new Error(`Request failed (${res.status})`);
      }
      if (res.status === 429) {
        setError("Too many requests. Please wait a few minutes and try again.");
        setPhase("idle");
        return;
      }
      setPhase("sent");
    } catch {
      setError("Cannot connect to the backend server. Ensure it is running and try again.");
      setPhase("idle");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[440px]">
          {phase === "sent" ? (
            <div className="text-center">
              <Image src="/logo.png" alt="PurveX" width={40} height={40} className="mx-auto mb-4 rounded-md" />
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)]">
                <CheckCircle2 className="h-6 w-6 text-[var(--accent-strong)]" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
              <p className="mt-2 text-base text-muted-foreground">
                If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset link is on its way.
              </p>
              <Link
                href="/login"
                className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-10 flex flex-col items-center text-center">
                <Image src="/logo.png" alt="PurveX" width={40} height={40} className="mb-4 rounded-md" />
                <h1 className="text-3xl font-semibold tracking-tight">Reset your password</h1>
                <p className="mt-2 text-base text-muted-foreground">
                  Enter the email associated with your account and we'll send you a reset link.
                </p>
              </div>

              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <div>
                  <label htmlFor="email" className={FIELD_LABEL_CLASSNAME}>
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (fieldError) setFieldError(undefined);
                      }}
                      disabled={phase === "submitting"}
                      aria-invalid={!!fieldError}
                      aria-describedby="email-error"
                      className={FIELD_CLASSNAME}
                    />
                  </div>
                  <FieldError id="email-error" message={fieldError} />
                </div>

                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-800 dark:border-red-500/20 dark:bg-red-500/[0.08] dark:text-red-200">
                    {error}
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
                      Sending
                    </>
                  ) : (
                    "Send reset link"
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
