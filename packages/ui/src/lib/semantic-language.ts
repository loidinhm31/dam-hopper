import type { SemanticLanguage } from "@dam-hopper/shared";
import { mimeToMonacoLanguage } from "@/lib/mime-to-language.js";

export function semanticLanguageForFile(
  mime: string | undefined,
  path: string,
): SemanticLanguage | null {
  const language = mimeToMonacoLanguage(mime, path);
  return isSemanticLanguage(language) ? language : null;
}

export function isSemanticLanguage(value: string): value is SemanticLanguage {
  return (
    value === "rust" ||
    value === "typescript" ||
    value === "javascript" ||
    value === "java"
  );
}
