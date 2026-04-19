import { redirect } from "next/navigation";

export default async function DetectionAlertDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string; alertId: string }>;
}) {
  const { id, alertId } = await params;
  redirect(`/detections/${id}/events?openEvent=${alertId}`);
}
