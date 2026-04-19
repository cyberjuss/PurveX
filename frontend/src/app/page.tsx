import { redirect } from "next/navigation";

export default function Page() {
  redirect("/login");
}

// Home page (MVP)
// - Server-side redirect so root never renders the app shell/splash.
