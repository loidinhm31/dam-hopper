/**
 * Workbench typography and virtualization geometry helpers.
 *
 * Keeps react-arborist uniform row heights synchronized with the adaptive
 * typography contract driven by --app-font-size / systemFontSize.
 */

export const FILE_TREE_MIN_ROW_HEIGHT = 24;

/**
 * Computes the Arborist row height for a given system font size in pixels.
 *
 * Corresponds to:
 * - text-xs font size: systemFontSize * 0.857
 * - unitless line-height: 4 / 3
 * - vertical padding py-0.5: 2px top + 2px bottom = 4px
 * - floor of 24px to safely house 16px icons and compact hit targets
 */
export function getFileTreeRowHeight(systemFontSize: number): number {
  const numericSize =
    typeof systemFontSize === "number" &&
    !Number.isNaN(systemFontSize) &&
    systemFontSize > 0
      ? systemFontSize
      : 14;
  const safeFontSize = Math.max(10, Math.min(32, numericSize));
  const textHeight = safeFontSize * 0.857 * (4 / 3);
  const totalHeight = Math.ceil(textHeight + 4);
  return Math.max(FILE_TREE_MIN_ROW_HEIGHT, totalHeight);
}
