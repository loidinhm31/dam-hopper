/**
 * PtySessionManager for the server package.
 *
 * This re-exports `PtySessionManager` from the electron package's pty directory.
 * In the server context, we import the same implementation — it's pure Node.js
 * (no Electron API). The EventSink interface is also re-exported from our local
 * ws/event-sink.ts which mirrors the electron package's interface.
 *
 * NOTE: Because this is a standalone package, we copy the PtySessionManager source
 * here rather than depending on the private electron package.
 */

export { PtySessionManager } from "./session-manager-impl.js";
