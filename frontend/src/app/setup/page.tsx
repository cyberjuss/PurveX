"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { bootstrapAdmin, getBootstrapStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageContainer } from "@/components/layout/page-container";

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Unable to check setup status.");
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
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError("Username and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      await bootstrapAdmin({
        username: username.trim(),
        password,
        email: email.trim() || undefined,
      });
      router.replace("/login");
    } catch (err: any) {
      setError(err?.message || "Failed to create admin user.");
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
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="username">Admin username</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email (optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
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
