/**
 * Re-encode a picked image to a JPEG small enough for Anthropic's image
 * limit. Shared by the schedule import modal and the nucleusAI panel, which
 * both hand a photo to a vision model.
 */

/**
 * Decode an arbitrary image file via the browser and re-encode as a JPEG
 * that fits under Anthropic's 5 MB image limit. Iterates max-edge then
 * quality, falling back to ever-smaller dimensions until under budget.
 *
 * Throws if the browser can't decode the source (e.g. HEIC in Chromium).
 */
export async function normalizeImage(file: File): Promise<{ bytes: ArrayBuffer; mediaType: string }> {
  // Stay well under 5 MB even after base64 inflation (~33%). 3.5 MB raw
  // ≈ 4.66 MB base64 — comfortable.
  const TARGET_BYTES = 3.5 * 1024 * 1024;

  const dataUrl = await readDataUrl(file);
  const img = await decodeImage(dataUrl);

  const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const edges = [2048, 1600, 1280, 1024, 768];
  const qualities = [0.9, 0.82, 0.72, 0.6];

  for (const maxEdge of edges) {
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const w = Math.round((img.naturalWidth || img.width) * scale);
    const h = Math.round((img.naturalHeight || img.height) * scale);
    for (const q of qualities) {
      const blob = await encodeJpeg(img, w, h, q);
      if (blob.size <= TARGET_BYTES) {
        return { bytes: await blob.arrayBuffer(), mediaType: "image/jpeg" };
      }
    }
  }

  // Pathological — extreme resolution + non-photographic content. Last-resort
  // hard compress at the smallest tier.
  const blob = await encodeJpeg(img, 768, 768, 0.5);
  return { bytes: await blob.arrayBuffer(), mediaType: "image/jpeg" };
}

async function encodeJpeg(img: HTMLImageElement, w: number, h: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't re-encode as JPEG."))),
      "image/jpeg",
      quality,
    );
  });
}

async function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsDataURL(file);
  });
}

async function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't decode this image format."));
    i.src = dataUrl;
  });
}
