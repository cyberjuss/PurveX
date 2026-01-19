"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function Page() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function routeBySession() {
      try {
        await apiFetch("/auth/me");
        if (!cancelled) {
          router.replace("/dashboard");
        }
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    }

    void routeBySession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return null;
  }

  return null;
}

// Home page (MVP)
// - Acts as a smart router based on the server-side session (/auth/me).
// - Redirects users to /dashboard or /login and keeps the root route free of UI so we
//   can evolve the landing experience later without affecting auth flow.
