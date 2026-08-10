import { issueVideoTicket } from "@/api/video-tickets.js";

/**
 * Starts browser-managed video download without reading media bytes in JavaScript.
 * The download ticket is deliberately not revoked after the click.
 */
export async function startVideoDownload(
  project: string,
  path: string,
): Promise<void> {
  const ticket = await issueVideoTicket(project, path, "download");
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
