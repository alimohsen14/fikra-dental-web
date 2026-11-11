import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { ImageKind } from '../clinic/logo.js';
import { getUploadDir } from '../config/env.js';

/** <clinic uuid>-<16 hex>.<ext>. Anything else is never read from or written to disk. */
export const XRAY_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{16}\.(png|jpg|webp)$/;

/** X-ray images on disk. In production the folder must be a persistent volume (or swap this class for object storage). */
@Injectable()
export class XrayStorage {
  private dir() {
    return resolve(getUploadDir(), 'xrays');
  }

  async save(clinicId: string, data: Buffer, kind: ImageKind): Promise<string> {
    await mkdir(this.dir(), { recursive: true });
    const file = `${clinicId}-${randomBytes(8).toString('hex')}.${kind.ext}`;
    await writeFile(join(this.dir(), file), data, { flag: 'wx' });
    return file;
  }

  /** Full path of a stored image, or null when the name is not one of ours. */
  pathOf(file: string): string | null {
    return XRAY_FILE_RE.test(file) ? join(this.dir(), file) : null;
  }

  async remove(file: string): Promise<void> {
    const path = this.pathOf(file);
    if (path) await unlink(path).catch(() => undefined);
  }
}
