// Hands a file to the browser to save, as a link to it with a name would:
// the file never leaves the computer, and the link is let go once used.
export function saveFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the file a moment after the click.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
