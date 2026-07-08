function padTimestampPart(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDownloadTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = padTimestampPart(date.getMonth() + 1);
  const day = padTimestampPart(date.getDate());
  const hours = padTimestampPart(date.getHours());
  const minutes = padTimestampPart(date.getMinutes());
  const seconds = padTimestampPart(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function downloadJson(
  value: unknown,
  options: {
    filePrefix: string;
    now?: Date;
  },
): string {
  const fileName = `${options.filePrefix}-${formatDownloadTimestamp(options.now ?? new Date())}.json`;
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return fileName;
}
