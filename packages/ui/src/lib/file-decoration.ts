import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Braces,
  Container,
  Database,
  File,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileLock2,
  FileText,
  Globe,
  Hammer,
  ImageIcon,
  Package,
  ScrollText,
  Settings2,
} from "lucide-react";

const ENV_FILE_NAME = `.${"env"}`;

export interface FileDecoration {
  icon: LucideIcon;
  colorClass: string;
  badge?: string;
  displayLanguage: string;
  monacoLanguage: string;
}

const DEFAULT_FILE_DECORATION: FileDecoration = {
  icon: File,
  colorClass: "text-[var(--color-text-muted)]",
  displayLanguage: "Plain Text",
  monacoLanguage: "plaintext",
};

const GENERIC_IMAGE_DECORATION: FileDecoration = {
  icon: FileImage,
  colorClass: "text-pink-400",
  badge: "IMG",
  displayLanguage: "Image",
  monacoLanguage: "plaintext",
};

const EXACT_FILE_DECORATIONS: Record<string, FileDecoration> = {
  ".editorconfig": { icon: Settings2, colorClass: "text-slate-300", badge: "CFG", displayLanguage: "EditorConfig", monacoLanguage: "ini" },
  [ENV_FILE_NAME]: { icon: FileLock2, colorClass: "text-emerald-400", badge: "ENV", displayLanguage: "Environment", monacoLanguage: "shell" },
  ".gitignore": { icon: FileCog, colorClass: "text-orange-400", badge: "GIT", displayLanguage: "Git Ignore", monacoLanguage: "plaintext" },
  ".npmrc": { icon: Settings2, colorClass: "text-red-400", badge: "NPM", displayLanguage: "NPM Config", monacoLanguage: "ini" },
  "cargo.lock": { icon: Package, colorClass: "text-orange-400", badge: "LOCK", displayLanguage: "Cargo Lock", monacoLanguage: "toml" },
  "cargo.toml": { icon: Settings2, colorClass: "text-orange-400", badge: "CFG", displayLanguage: "TOML", monacoLanguage: "toml" },
  dockerfile: { icon: Container, colorClass: "text-sky-400", badge: "DOCKER", displayLanguage: "Dockerfile", monacoLanguage: "dockerfile" },
  license: { icon: ScrollText, colorClass: "text-slate-300", badge: "TXT", displayLanguage: "License", monacoLanguage: "plaintext" },
  makefile: { icon: Hammer, colorClass: "text-amber-400", badge: "MAKE", displayLanguage: "Makefile", monacoLanguage: "plaintext" },
  "package-lock.json": { icon: Package, colorClass: "text-red-400", badge: "LOCK", displayLanguage: "JSON", monacoLanguage: "json" },
  "package.json": { icon: Package, colorClass: "text-red-400", badge: "NPM", displayLanguage: "JSON", monacoLanguage: "json" },
  "pnpm-lock.yaml": { icon: Package, colorClass: "text-orange-400", badge: "LOCK", displayLanguage: "YAML", monacoLanguage: "yaml" },
  readme: { icon: FileText, colorClass: "text-indigo-300", badge: "MD", displayLanguage: "README", monacoLanguage: "markdown" },
  "tsconfig.json": { icon: Settings2, colorClass: "text-blue-400", badge: "CFG", displayLanguage: "JSON", monacoLanguage: "json" },
  "yarn.lock": { icon: Package, colorClass: "text-cyan-400", badge: "LOCK", displayLanguage: "YAML", monacoLanguage: "yaml" },
};

const EXTENSION_DECORATIONS: Record<string, FileDecoration> = {
  c: { icon: FileCode2, colorClass: "text-sky-400", badge: "C", displayLanguage: "C", monacoLanguage: "c" },
  cpp: { icon: FileCode2, colorClass: "text-sky-400", badge: "C++", displayLanguage: "C++", monacoLanguage: "cpp" },
  css: { icon: Globe, colorClass: "text-blue-400", badge: "CSS", displayLanguage: "CSS", monacoLanguage: "css" },
  csv: { icon: Database, colorClass: "text-emerald-400", badge: "CSV", displayLanguage: "CSV", monacoLanguage: "plaintext" },
  gif: GENERIC_IMAGE_DECORATION,
  gz: { icon: Archive, colorClass: "text-amber-400", badge: "ZIP", displayLanguage: "Archive", monacoLanguage: "plaintext" },
  go: { icon: FileCode2, colorClass: "text-cyan-400", badge: "GO", displayLanguage: "Go", monacoLanguage: "go" },
  h: { icon: FileCode2, colorClass: "text-sky-400", badge: "C", displayLanguage: "C Header", monacoLanguage: "c" },
  html: { icon: Globe, colorClass: "text-orange-400", badge: "HTML", displayLanguage: "HTML", monacoLanguage: "html" },
  ico: GENERIC_IMAGE_DECORATION,
  java: { icon: FileCode2, colorClass: "text-orange-500", badge: "JAVA", displayLanguage: "Java", monacoLanguage: "java" },
  jpeg: GENERIC_IMAGE_DECORATION,
  jpg: GENERIC_IMAGE_DECORATION,
  js: { icon: FileCode2, colorClass: "text-yellow-300", badge: "JS", displayLanguage: "JavaScript", monacoLanguage: "javascript" },
  json: { icon: FileJson, colorClass: "text-amber-300", badge: "JSON", displayLanguage: "JSON", monacoLanguage: "json" },
  jsx: { icon: FileCode2, colorClass: "text-cyan-300", badge: "JSX", displayLanguage: "JavaScript", monacoLanguage: "javascript" },
  log: { icon: ScrollText, colorClass: "text-[var(--color-text-muted)]", badge: "LOG", displayLanguage: "Log", monacoLanguage: "plaintext" },
  md: { icon: FileText, colorClass: "text-indigo-300", badge: "MD", displayLanguage: "Markdown", monacoLanguage: "markdown" },
  mp3: { icon: File, colorClass: "text-violet-300", badge: "AUD", displayLanguage: "Audio", monacoLanguage: "plaintext" },
  mp4: { icon: File, colorClass: "text-violet-300", badge: "VID", displayLanguage: "Video", monacoLanguage: "plaintext" },
  otf: { icon: File, colorClass: "text-teal-300", badge: "FONT", displayLanguage: "Font", monacoLanguage: "plaintext" },
  pdf: { icon: FileText, colorClass: "text-red-300", badge: "PDF", displayLanguage: "PDF", monacoLanguage: "plaintext" },
  png: GENERIC_IMAGE_DECORATION,
  py: { icon: FileCode2, colorClass: "text-yellow-400", badge: "PY", displayLanguage: "Python", monacoLanguage: "python" },
  rs: { icon: FileCode2, colorClass: "text-orange-400", badge: "RS", displayLanguage: "Rust", monacoLanguage: "rust" },
  tar: { icon: Archive, colorClass: "text-amber-400", badge: "ZIP", displayLanguage: "Archive", monacoLanguage: "plaintext" },
  sh: { icon: ScrollText, colorClass: "text-emerald-400", badge: "SH", displayLanguage: "Shell", monacoLanguage: "shell" },
  svg: { icon: ImageIcon, colorClass: "text-fuchsia-400", badge: "SVG", displayLanguage: "SVG", monacoLanguage: "xml" },
  ttf: { icon: File, colorClass: "text-teal-300", badge: "FONT", displayLanguage: "Font", monacoLanguage: "plaintext" },
  toml: { icon: Settings2, colorClass: "text-orange-400", badge: "TOML", displayLanguage: "TOML", monacoLanguage: "toml" },
  ts: { icon: FileCode2, colorClass: "text-blue-400", badge: "TS", displayLanguage: "TypeScript", monacoLanguage: "typescript" },
  tsx: { icon: FileCode2, colorClass: "text-cyan-300", badge: "TSX", displayLanguage: "TypeScript", monacoLanguage: "typescript" },
  txt: { icon: FileText, colorClass: "text-[var(--color-text-muted)]", badge: "TXT", displayLanguage: "Plain Text", monacoLanguage: "plaintext" },
  woff: { icon: File, colorClass: "text-teal-300", badge: "FONT", displayLanguage: "Font", monacoLanguage: "plaintext" },
  woff2: { icon: File, colorClass: "text-teal-300", badge: "FONT", displayLanguage: "Font", monacoLanguage: "plaintext" },
  webp: GENERIC_IMAGE_DECORATION,
  xml: { icon: Braces, colorClass: "text-lime-300", badge: "XML", displayLanguage: "XML", monacoLanguage: "xml" },
  yaml: { icon: Settings2, colorClass: "text-violet-300", badge: "YAML", displayLanguage: "YAML", monacoLanguage: "yaml" },
  yml: { icon: Settings2, colorClass: "text-violet-300", badge: "YAML", displayLanguage: "YAML", monacoLanguage: "yaml" },
  "7z": { icon: Archive, colorClass: "text-amber-400", badge: "ZIP", displayLanguage: "Archive", monacoLanguage: "plaintext" },
  zip: { icon: Archive, colorClass: "text-amber-400", badge: "ZIP", displayLanguage: "Archive", monacoLanguage: "plaintext" },
};

function normalizeMime(mime?: string): string {
  return mime?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function getExactNameDecoration(baseName: string): FileDecoration | null {
  const exactName = baseName.toLowerCase();
  if (exactName.startsWith(`${ENV_FILE_NAME}.`)) {
    return EXACT_FILE_DECORATIONS[ENV_FILE_NAME];
  }
  if (exactName.startsWith("dockerfile.")) {
    return EXACT_FILE_DECORATIONS.dockerfile;
  }
  return EXACT_FILE_DECORATIONS[exactName] ?? null;
}

function getBaseName(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() ?? pathOrName;
}

function getExtension(baseName: string): string {
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === baseName.length - 1) return "";
  return baseName.slice(dotIndex + 1).toLowerCase();
}

function getMimeDecoration(mime?: string): FileDecoration | null {
  const normalizedMime = normalizeMime(mime);
  if (!normalizedMime) return null;
  if (
    normalizedMime === "application/typescript" ||
    normalizedMime === "text/typescript" ||
    normalizedMime.endsWith("+typescript")
  ) {
    return EXTENSION_DECORATIONS.tsx;
  }
  if (
    normalizedMime === "application/javascript" ||
    normalizedMime === "text/javascript" ||
    normalizedMime.endsWith("+javascript")
  ) {
    return EXTENSION_DECORATIONS.jsx;
  }
  if (normalizedMime === "application/json" || normalizedMime.endsWith("+json")) return EXTENSION_DECORATIONS.json;
  if (normalizedMime === "text/html") return EXTENSION_DECORATIONS.html;
  if (normalizedMime === "text/css") return EXTENSION_DECORATIONS.css;
  if (normalizedMime === "image/svg+xml") return EXTENSION_DECORATIONS.svg;
  if (normalizedMime === "application/xml" || normalizedMime === "text/xml" || normalizedMime.endsWith("+xml")) return EXTENSION_DECORATIONS.xml;
  if (normalizedMime === "text/markdown" || normalizedMime === "text/x-markdown") return EXTENSION_DECORATIONS.md;
  if (normalizedMime === "text/rust" || normalizedMime === "application/rust") return EXTENSION_DECORATIONS.rs;
  if (normalizedMime === "text/x-python" || normalizedMime === "application/x-python-code") return EXTENSION_DECORATIONS.py;
  if (normalizedMime === "application/yaml" || normalizedMime === "text/yaml" || normalizedMime === "text/x-yaml") return EXTENSION_DECORATIONS.yaml;
  if (normalizedMime === "application/toml" || normalizedMime === "text/toml") return EXTENSION_DECORATIONS.toml;
  if (normalizedMime === "text/plain") return EXTENSION_DECORATIONS.txt;
  if (normalizedMime.startsWith("image/")) return GENERIC_IMAGE_DECORATION;
  return null;
}

export function getFileDecoration(pathOrName: string, options?: { mime?: string }): FileDecoration {
  const baseName = getBaseName(pathOrName);
  return (
    getExactNameDecoration(baseName) ??
    EXTENSION_DECORATIONS[getExtension(baseName)] ??
    getMimeDecoration(options?.mime) ??
    DEFAULT_FILE_DECORATION
  );
}

export function getDisplayLanguage(pathOrName: string, mime?: string): string {
  return getFileDecoration(pathOrName, { mime }).displayLanguage;
}

export function getMonacoLanguage(pathOrName: string, mime?: string): string {
  return getFileDecoration(pathOrName, { mime }).monacoLanguage;
}
