"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TestsRunPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/run-test");
  }, [router]);

  return null;
}

