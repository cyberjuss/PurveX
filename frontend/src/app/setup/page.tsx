"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Loader2, Lock, User } from "lucide-react";
import { bootstrapAdmin, getBootstrapStatus } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { FieldError, FormError } from "@/components/ui/form-error";
import { useZodForm } from "@/lib/forms";
import { passwordSchema, usernameSchema } from "@/lib/validators";

const PRIMARY_BUTTON_CLASSNAME =
  "border border-primary bg-primary text-primary-foreground hover:bg-primary/90";

const FIELD_LABEL_CLASSNAME =
  "mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80";

const FIELD_CLASSNAME =
  "h-12 rounded-[10px] border border-black/[0.08] bg-black/[0.015] pl-11 text-base shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-150 placeholder:text-muted-foreground/50 hover:border-black/[0.14] focus-visible:border-primary/60 focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:shadow-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:focus-visible:border-primary/50";

const setupSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const form = useZodForm(setupSchema, {
    username: "admin",
    password: "",
    confirmPassword: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const status = await getBootstrapStatus();
        if (cancelled) return;
        if (!status.needs_admin) {
          router.replace("/login");
          return;
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Unable to check setup status.";
          setServerError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const parsed = form.validate();
    if (!parsed.success) return;
    if (!agreedToTerms) {
      setServerError("You must agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }

    setSubmitting(true);
    try {
      await bootstrapAdmin({
        username: parsed.data.username,
        password: parsed.data.password,
      });
      router.replace("/login");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create admin user.";
      setServerError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-10 flex flex-col items-center text-center">
            <Image src="/logo.png" alt="PurveX" width={40} height={40} className="mb-4 rounded-md" />
            <h1 className="text-3xl font-semibold tracking-tight">Create admin account</h1>
            <p className="mt-2 text-base text-muted-foreground">
              Set a username and password to get started.
            </p>
          </div>

          {loading ? (
            <div className="text-center text-sm text-muted-foreground">Checking setup status…</div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <FormError message={serverError} />

              <div>
                <label htmlFor="username" className={FIELD_LABEL_CLASSNAME}>
                  Admin username
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    id="username"
                    value={form.values.username}
                    onChange={(e) => form.setField("username", e.target.value)}
                    onBlur={() => form.touch("username")}
                    autoComplete="username"
                    autoFocus
                    aria-invalid={!!form.errors.username}
                    aria-describedby="username-error"
                    className={FIELD_CLASSNAME}
                  />
                </div>
                <FieldError id="username-error" message={form.errors.username} />
              </div>

              <div>
                <label htmlFor="password" className={FIELD_LABEL_CLASSNAME}>
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    id="password"
                    type="password"
                    value={form.values.password}
                    onChange={(e) => form.setField("password", e.target.value)}
                    onBlur={() => form.touch("password")}
                    autoComplete="new-password"
                    aria-invalid={!!form.errors.password}
                    aria-describedby="password-error"
                    className={FIELD_CLASSNAME}
                  />
                </div>
                <FieldError id="password-error" message={form.errors.password} />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  At least 12 characters, including upper, lower, and a number.
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className={FIELD_LABEL_CLASSNAME}>
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={form.values.confirmPassword}
                    onChange={(e) => form.setField("confirmPassword", e.target.value)}
                    onBlur={() => form.touch("confirmPassword")}
                    autoComplete="new-password"
                    aria-invalid={!!form.errors.confirmPassword}
                    aria-describedby="confirmPassword-error"
                    className={FIELD_CLASSNAME}
                  />
                </div>
                <FieldError id="confirmPassword-error" message={form.errors.confirmPassword} />
              </div>

              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  I agree to the{" "}
                  <a href="https://purve-x-landing-page.vercel.app/legal/terms" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="https://purve-x-landing-page.vercel.app/legal/privacy" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${PRIMARY_BUTTON_CLASSNAME}`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating
                  </>
                ) : (
                  "Create admin"
                )}
              </button>
            </form>
          )}
        </div>
      </div>

      <p className="pb-6 text-center text-[11px] text-muted-foreground">
        &copy; {new Date().getFullYear()} PurveX
      </p>
    </div>
  );
}
