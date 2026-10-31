import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { Request } from 'express';

export const LOGO_MAX_BYTES = 512 * 1024;

export type ImageKind = { ext: 'png' | 'jpg' | 'webp'; mime: string };

export const MIME_BY_EXT: Record<ImageKind['ext'], string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * What the file REALLY is, from its first bytes. The type the browser claims is never trusted.
 * SVG is deliberately not allowed: it can carry scripts.
 */
export function detectImage(b: Buffer): ImageKind | null {
  if (b.length < 16) return null;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: MIME_BY_EXT.png };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: MIME_BY_EXT.jpg };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: MIME_BY_EXT.webp };
  return null;
}

/** <clinic uuid>-<16 hex>.<ext>. Anything else is never read from or written to disk. */
export const LOGO_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{16}\.(png|jpg|webp)$/;

export const LOGO_URL_PREFIX = '/clinic/logo/';

/** Reads the raw request body, at most `limit` bytes. The extra bytes of a too-big upload are thrown away, not stored. */
export async function readBody(req: Request, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  const tooBig = () => new PayloadTooLargeException('الصورة كبيرة، الحد الأقصى 512 كيلوبايت');
  if (Number.isFinite(declared) && declared > limit * 8) {
    req.destroy();
    throw tooBig();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = false;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      exceeded = true;
      chunks.length = 0; // keep draining (so the answer can be delivered) but store nothing
      if (size > limit * 8) {
        req.destroy();
        break;
      }
    } else if (!exceeded) chunks.push(chunk as Buffer);
  }
  if (exceeded) throw tooBig();
  if (size === 0) throw new BadRequestException('ما في صورة بالطلب');
  return Buffer.concat(chunks);
}
