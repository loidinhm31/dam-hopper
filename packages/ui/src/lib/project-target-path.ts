/**
 * Stable lexical identity for target reconciliation. It keeps UNC paths in
 * their own namespace so `//server/share` cannot collide with
 * `/server/share`, and works even when the target no longer exists.
 */
export function normalizeProjectTargetPath(path: string): string {
  const runtimePlatform =
    typeof window !== "undefined"
      ? (window as { damHopper?: { platform?: string } }).damHopper?.platform
      : undefined;
  const explicitWindowsPath =
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\") ||
    /^\/\/\?\/(?:unc\/|[A-Za-z]:[\\/])/i.test(path);
  const windowsStyle = runtimePlatform === "win32" || explicitWindowsPath;
  let normalized = windowsStyle ? path.replaceAll("\\", "/") : path;
  const extendedUnc = windowsStyle && /^\/\/\?\/unc\//i.test(normalized);
  const extendedDrive = windowsStyle && /^\/\/\?\/[A-Za-z]:\//.test(normalized);
  if (extendedUnc) {
    normalized = "//" + normalized.slice("//?/UNC/".length);
  } else if (extendedDrive) {
    normalized = normalized.slice("//?/".length);
  }

  const isUnc = windowsStyle && /^(?:\\\\|\/\/)/.test(normalized);
  const drive = windowsStyle
    ? normalized.match(/^([A-Za-z]):[\\/]/)?.[1]
    : undefined;
  const isAbsolute = normalized.startsWith("/");
  const posixDoubleSlash = !windowsStyle && normalized.startsWith("//");
  const body = isUnc
    ? normalized.replace(/^\/+/, "")
    : drive
      ? normalized.slice(3)
      : normalized.replace(/^\/+/, "");
  const segments: string[] = [];
  for (const segment of body.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === ".." && segments.length > 0 && segments.at(-1) !== "..") {
      segments.pop();
    } else if (segment !== "..") {
      segments.push(segment);
    }
  }

  const suffix = segments.join("/");
  if (isUnc) return `//${suffix}`.toLowerCase();
  if (drive) return `${drive.toLowerCase()}:/${suffix}`.toLowerCase();
  if (isAbsolute) return `${posixDoubleSlash ? "//" : "/"}${suffix}`;
  return suffix;
}
