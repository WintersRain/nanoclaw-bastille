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

/**
 * Save Discord attachment buffers to disk under groups/{folder}/attachments/{messageId}/.
 * Returns metadata for each saved file (for DB storage via buildMessageContent).
 * Downloads happen immediately because Discord CDN URLs expire.
 */
export function downloadAttachments(
  groupDir: string,
  messageId: string,
  attachments: Array<{ name: string; contentType: string; buffer: Buffer }>,
): Array<{ name: string; contentType: string; relativePath: string }> {
  if (attachments.length === 0) return [];

  const attachDir = path.join(groupDir, 'attachments', messageId);
  fs.mkdirSync(attachDir, { recursive: true });

  const result: Array<{ name: string; contentType: string; relativePath: string }> = [];

  for (const att of attachments) {
    const safeName = (att.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.writeFileSync(path.join(attachDir, safeName), att.buffer);
    result.push({
      name: safeName,
      contentType: att.contentType,
      relativePath: `attachments/${messageId}/${safeName}`,
    });
  }

  return result;
}

/**
 * Validate that a file is a safe image type for multimodal processing.
 * Rejects non-image MIME types and SVG (which can contain embedded scripts).
 */
export function isImageSafeForProcessing(name: string, mimeType: string): boolean {
  return IMAGE_TYPES.has(mimeType);
}
