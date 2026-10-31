import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { getUploadDir } from '../config/env.js';
import { LOGO_FILE_RE, LOGO_URL_PREFIX } from './logo.js';
import type { ImageKind } from './logo.js';

/** Clinic logos on disk. In production the folder must be a persistent volume (or swap this class for object storage). */
@Injectable()
export class LogoStorage {
  private dir() {
    return resolve(getUploadDir(), 'logos');
  }

  async save(clinicId: string, data: Buffer, kind: ImageKind): Promise<string> {
    await mkdir(this.dir(), { recursive: true });
    const file = `${clinicId}-${randomBytes(8).toString('hex')}.${kind.ext}`;
    await writeFile(join(this.dir(), file), data, { flag: 'wx' });
    return LOGO_URL_PREFIX + file;
  }

  /** Full path of a stored logo, or null when the name is not one of ours. */
  pathOf(file: string): string | null {
    return LOGO_FILE_RE.test(file) ? join(this.dir(), file) : null;
  }

  /** Deletes the file a logoUrl points to. Foreign URLs (anything not made by save) are ignored. */
  async removeByUrl(url: string | null | undefined): Promise<void> {
    if (!url?.startsWith(LOGO_URL_PREFIX)) return;
    const path = this.pathOf(url.slice(LOGO_URL_PREFIX.length));
    if (!path) return;
    await unlink(path).catch(() => undefined);
  }
}
