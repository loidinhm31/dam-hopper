export function normalizeRouterBasename(baseUrl: string | undefined): string {
  if (!baseUrl || baseUrl === "." || baseUrl === "./") {
    return "/";
  }

  if (baseUrl.startsWith(".")) {
    return "/";
  }

  const withLeadingSlash = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;

  if (withLeadingSlash === "/") {
    return withLeadingSlash;
  }

  return withLeadingSlash.replace(/\/+$/, "");
}
