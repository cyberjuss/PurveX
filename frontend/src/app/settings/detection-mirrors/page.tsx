import { redirect } from "next/navigation";

export default function DetectionMirrorsRedirectPage() {
  redirect("/settings/detection-sources?tab=export");
}
