/**
 * Copying to the clipboard, and saying whether it worked.
 *
 * `navigator.clipboard` is unavailable on insecure origins and refused when the
 * call is not inside a user gesture, so every path here can fail and the caller
 * is told rather than left to assume.
 *
 * For text there is a legacy fallback worth keeping: `execCommand("copy")`
 * still works in every browser this targets and covers a page served over
 * plain HTTP — which is exactly how someone serving a data tree from a
 * workshop machine will run it.
 */

/** Put text on the clipboard. False when the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyTextLegacy(text);
  }
}

function copyTextLegacy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Off-screen but not `display: none`: a hidden element cannot be selected,
    // and `readonly` stops the keyboard appearing on iOS.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Put an image on the clipboard as a PNG.
 *
 * `blob` is a **factory, not a blob**, and that is the whole subtlety: Safari
 * only accepts a pending promise handed to `ClipboardItem` from inside the
 * user gesture. Awaiting the canvas first and passing the resolved blob works
 * in Chrome and fails in Safari, which is a difference no test in Node will
 * ever show you.
 *
 * There is no fallback. `ClipboardItem` is the only way to put an image on the
 * clipboard, so a browser without it gets `false` and the caller offers a
 * download instead.
 */
export async function copyImage(blob: () => Promise<Blob>): Promise<boolean> {
  try {
    if (!("ClipboardItem" in globalThis)) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * A canvas as a PNG blob.
 *
 * Rejects rather than resolving null, so `copyImage` fails cleanly instead of
 * handing `ClipboardItem` an empty item.
 */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas produced no image"))),
      "image/png",
    );
  });
}

/**
 * Hand a file to the browser as a download.
 *
 * A `data:` URL would be simpler, is capped at a couple of megabytes in some
 * browsers and silently ignored for downloads in others; an object URL is the
 * reliable route. Revoked on the next task rather than immediately, because
 * Safari has not started the download by the time the click handler returns.
 *
 * `bom` is opt-in and must stay that way. A leading BOM is what makes Excel
 * read a UTF-8 CSV as UTF-8 rather than the system code page — and it is also
 * what makes `JSON.parse` reject a file outright, so the notes export must not
 * have one.
 */
export function download(
  name: string,
  text: string,
  { type = "text/csv;charset=utf-8", bom = false }: { type?: string; bom?: boolean } = {},
): void {
  const blob = new Blob(bom ? ["﻿", text] : [text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
