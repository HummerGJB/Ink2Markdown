export function isRemoteLink(link: string): boolean {
  return /^(https?:\/\/|data:|app:|obsidian:)/i.test(link.trim());
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function formatTimestampForFilename(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}${minutes}${seconds}`;
}

export function getCaptureExtension(file: File): string {
  const name = file.name?.trim();
  if (name && name.includes(".")) {
    const ext = name.split(".").pop();
    if (ext) {
      return ext.toLowerCase();
    }
  }

  const type = file.type?.toLowerCase();
  switch (type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/tiff":
      return "tiff";
    case "image/bmp":
      return "bmp";
    default:
      return "jpg";
  }
}
