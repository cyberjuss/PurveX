import { redirect } from "next/navigation";

export default function DetectionAlertDetailRedirectPage({
  params,
}: {
  params: { id: string; alertId: string };
}) {
  redirect(`/detections/${params.id}/events/${params.alertId}`);
}
