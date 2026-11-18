import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { ImageKind } from '../clinic/logo.js';
import { getUploadDir } from '../config/env.js';

/** <clinic uuid>-<16 hex>.<ext>. Anything else is never read from or written to disk. */
export const CHEQUE_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{16}\.(png|jpg|webp)$/;

/** Cheque photos on disk (same rules as x-rays: persistent volume in production, or swap this class for object storage). */
@Injectable()
export class ChequeStorage {
  private dir() {
    return resolve(getUploadDir(), 'cheques');
  }

  async save(clinicId: string, data: Buffer, kind: ImageKind): Promise<string> {
    await mkdir(this.dir(), { recursive: true });
    const file = `${clinicId}-${randomBytes(8).toString('hex')}.${kind.ext}`;
    await writeFile(join(this.dir(), file), data, { flag: 'wx' });
    return file;
  }

  pathOf(file: string): string | null {
    return CHEQUE_FILE_RE.test(file) ? join(this.dir(), file) : null;
  }

  async remove(file: string): Promise<void> {
    const path = this.pathOf(file);
    if (path) await unlink(path).catch(() => undefined);
  }
}
