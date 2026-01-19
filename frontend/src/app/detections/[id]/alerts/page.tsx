import { redirect } from "next/navigation";

export default function DetectionAlertsRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/detections/${params.id}/events`);
}
