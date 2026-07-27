import { redirect } from "next/navigation";

export default function ProposalsRedirectPage() {
  redirect("/detections?view=proposals");
}
