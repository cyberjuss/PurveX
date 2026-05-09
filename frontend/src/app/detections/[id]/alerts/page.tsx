import { redirect } from "next/navigation";

export default async function DetectionAlertsRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/detections/${id}#validation-evidence`);
}
