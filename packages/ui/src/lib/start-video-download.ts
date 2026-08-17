import { issueVideoTicket } from "@/api/video-tickets.js";
import type { ProjectTargetInput } from "@/api/client.js";

/**
 * Starts browser-managed video download without reading media bytes in JavaScript.
 * The download ticket is deliberately not revoked after the click.
 */
export async function startVideoDownload(
  target: ProjectTargetInput,
  path: string,
): Promise<void> {
  const ticket = await issueVideoTicket(target, path, "download");
  if (ticket.purpose !== "download")
    throw new Error("Video download unavailable");

  const anchor = document.createElement("a");
  anchor.href = ticket.url;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}
