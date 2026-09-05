import {
  getDisplayLanguage,
  getMonacoLanguage,
} from "@/lib/file-decoration.js";

/** Compatibility wrapper for display-language lookups from MIME-only call sites. */
export function mimeToLanguage(mime?: string, pathOrName = ""): string {
  return getDisplayLanguage(pathOrName, mime);
}

/** Compatibility wrapper for Monaco-language lookups from MIME-only call sites. */
export function mimeToMonacoLanguage(mime?: string, pathOrName = ""): string {
  return getMonacoLanguage(pathOrName, mime);
}
