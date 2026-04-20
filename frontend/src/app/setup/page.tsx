"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { bootstrapAdmin, getBootstrapStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageContainer } from "@/components/layout/page-container";
import { FieldError, FormError } from "@/components/ui/form-error";
import { useZodForm } from "@/lib/forms";
import {
  optionalEmailSchema,
  passwordSchema,
  usernameSchema,
} from "@/lib/validators";

const setupSchema = z.object({
  username: usernameSchema,
  email: optionalEmailSchema,
  password: passwordSchema,
});

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useZodForm(setupSchema, {
    username: "admin",
    email: "",
    password: "",
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

    setSubmitting(true);
    try {
      await bootstrapAdmin({
        username: parsed.data.username,
        password: parsed.data.password,
        email: parsed.data.email || undefined,
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
    <PageContainer maxWidth="md">
      <div className="min-h-[70vh] flex items-center justify-center py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>First-run setup</CardTitle>
            <CardDescription>Create the first admin account to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-slate-500">Checking setup status…</div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <FormError message={serverError} />

                <div className="space-y-2">
                  <Label htmlFor="username">Admin username</Label>
                  <Input
                    id="username"
                    value={form.values.username}
                    onChange={(e) => form.setField("username", e.target.value)}
                    onBlur={() => form.touch("username")}
                    autoComplete="username"
                    aria-invalid={!!form.errors.username}
                    aria-describedby="username-error"
                  />
                  <FieldError id="username-error" message={form.errors.username} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email (optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.values.email ?? ""}
                    onChange={(e) => form.setField("email", e.target.value)}
                    onBlur={() => form.touch("email")}
                    autoComplete="email"
                    aria-invalid={!!form.errors.email}
                    aria-describedby="email-error"
                  />
                  <FieldError id="email-error" message={form.errors.email} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={form.values.password}
                    onChange={(e) => form.setField("password", e.target.value)}
                    onBlur={() => form.touch("password")}
                    autoComplete="new-password"
                    aria-invalid={!!form.errors.password}
                    aria-describedby="password-error"
                  />
                  <FieldError id="password-error" message={form.errors.password} />
                  <p className="text-xs text-slate-500">
                    At least 12 characters, including upper, lower, and a number.
                  </p>
                </div>

                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create admin"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
