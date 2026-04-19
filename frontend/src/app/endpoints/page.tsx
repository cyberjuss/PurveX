"use server";

import { redirect } from "next/navigation";

export default async function EndpointsRedirectPage() {
  redirect("/settings/test-runner");
}
