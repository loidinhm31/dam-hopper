import type { PluginMetadataItem } from "@/api/client.js";

export function parsePluginMetadata(value: unknown): PluginMetadataItem | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item)
    .filter((k) => k !== "ownerHistorySource")
    .sort();
  const expected = [
    "activeDigest",
    "activeGeneration",
    "capabilities",
    "enabled",
    "hasUi",
    "id",
    "publisher",
    "version",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    typeof item.id !== "string" ||
    item.id.length === 0 ||
    typeof item.version !== "string" ||
    typeof item.publisher !== "string" ||
    !Array.isArray(item.capabilities) ||
    item.capabilities.some(
      (capability) => typeof capability !== "string" || capability.length === 0,
    ) ||
    typeof item.hasUi !== "boolean" ||
    typeof item.activeDigest !== "string" ||
    !Number.isSafeInteger(item.activeGeneration) ||
    (item.activeGeneration as number) < 0 ||
    typeof item.enabled !== "boolean"
  ) {
    return null;
  }
  return item as unknown as PluginMetadataItem;
}
