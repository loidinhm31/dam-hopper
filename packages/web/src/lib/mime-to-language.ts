import { getDisplayLanguage, getMonacoLanguage } from "@/lib/file-decoration.js";

/** Compatibility wrapper for display-language lookups from MIME-only call sites. */
export function mimeToLanguage(mime?: string): string {
  return getDisplayLanguage("", mime);
}

/** Compatibility wrapper for Monaco-language lookups from MIME-only call sites. */
export function mimeToMonacoLanguage(mime?: string): string {
  return getMonacoLanguage("", mime);
}
