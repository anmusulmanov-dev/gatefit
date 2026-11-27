/** A supported image format, recognised by its first bytes. */
export interface ImageType {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

/** Null for anything but JPEG, PNG and WebP, whatever the file name or declared type says. */
export function imageType(buffer: Buffer): ImageType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: 'image/png', extension: 'png' };
  }
  // RIFF....WEBP
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Width and height read from the image header, without decoding it. Null when the header
 * is missing or cut short: such a file is not accepted.
 */
export function imageSize(buffer: Buffer): ImageSize | null {
  const type = imageType(buffer);
  try {
    switch (type?.extension) {
      case 'png':
        // The IHDR chunk always comes first.
        return buffer.length >= 24
          ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
          : null;
      case 'jpg':
        return jpegSize(buffer);
      case 'webp':
        return webpSize(buffer);
      default:
        return null;
    }
  } catch {
    // A read past the end of a truncated file.
    return null;
  }
}

function jpegSize(buffer: Buffer): ImageSize | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null;
    }
    const marker = buffer[offset + 1] ?? 0;
    // Start-of-frame markers carry the size; 0xC4, 0xC8 and 0xCC are other tables.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

function webpSize(buffer: Buffer): ImageSize | null {
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  return null;
}
