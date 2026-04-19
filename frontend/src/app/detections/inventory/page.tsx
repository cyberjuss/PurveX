import { redirect } from "next/navigation";

export default function DetectionInventoryRedirectPage() {
  redirect("/detections?view=library");
}
