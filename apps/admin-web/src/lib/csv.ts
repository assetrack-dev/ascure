/** Save rows as a CSV the browser downloads (opens straight in Excel). */
export function downloadCsv(filename: string, lines: Array<Array<string | number>>) {
  const csv = lines
    .map((line) =>
      line
        .map(String)
        .map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
        .join(","),
    )
    .join("\r\n");
  // BOM so Excel reads the UTF-8 names correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
