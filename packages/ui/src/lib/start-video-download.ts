import { issueVideoTicket } from "@/api/video-tickets.js";
import type { ConnectionRef, ProjectTargetInput } from "@/api/client.js";

/**
 * Starts browser-managed video download without reading media bytes in JavaScript.
 * The download ticket is deliberately not revoked after the click.
 */
export async function startVideoDownload(
  target: ProjectTargetInput,
  path: string,
  owner?: ConnectionRef,
): Promise<void> {
  const ticket = await issueVideoTicket(
    target,
    path,
    "download",
    undefined,
    owner,
  );

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
