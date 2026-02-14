import fs from 'fs';
import path from 'path';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const DEFAULT_MAX_IMAGE_SIZE = 10 * 1024 * 1024;   // 10MB per image
const DEFAULT_MAX_TOTAL_SIZE = 20 * 1024 * 1024;    // 20MB total

const FILE_MARKER_REGEX = /\[file: (.+?) \| ([^\s|]+) \| (attachments\/[^\]]+)\]/g;

/**
 * Collect images from message content file markers.
 * Parses [file: name | mimeType | relativePath] markers, reads matching image files,
 * and returns base64-encoded data for Gemini multimodal injection.
 */
export function collectImages(
  messages: Array<{ content: string }>,
  groupDir: string,
  maxPerImage: number = DEFAULT_MAX_IMAGE_SIZE,
  maxTotal: number = DEFAULT_MAX_TOTAL_SIZE,
): Array<{ name: string; mimeType: string; data: string }> {
  const images: Array<{ name: string; mimeType: string; data: string }> = [];
  let totalSize = 0;

  for (const msg of messages) {
    let match;
    FILE_MARKER_REGEX.lastIndex = 0;
    while ((match = FILE_MARKER_REGEX.exec(msg.content)) !== null) {
      const [, name, mimeType, relativePath] = match;
      if (!IMAGE_TYPES.has(mimeType)) continue;

      const hostPath = path.join(groupDir, relativePath);
      try {
        if (!fs.existsSync(hostPath)) continue;
        const stat = fs.statSync(hostPath);
        if (stat.size > maxPerImage) continue;
        if (totalSize + stat.size > maxTotal) continue;
        const data = fs.readFileSync(hostPath).toString('base64');
        images.push({ name, mimeType, data });
        totalSize += stat.size;
      } catch {
        // Skip unreadable files
      }
    }
  }

  return images;
}
