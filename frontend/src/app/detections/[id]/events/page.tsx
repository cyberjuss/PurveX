import { redirect } from "next/navigation";

export default async function DetectionEventsRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ openEvent?: string }>;
}) {
  const { id } = await params;
  const { openEvent } = await searchParams;
  const evidenceQuery = openEvent ? `?evidence=${encodeURIComponent(openEvent)}` : "";
  redirect(`/detections/${id}${evidenceQuery}#validation-evidence`);
}
