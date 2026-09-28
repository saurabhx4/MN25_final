import fs from 'fs/promises';
import path from 'path';

export interface ObjectStorage {
  put(key: string, body: Buffer): Promise<string>;
  get(location: string): Promise<Buffer>;
  exists(location: string): Promise<boolean>;
}

class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}
  async put(key: string, body: Buffer) {
    const destination = path.join(this.root, key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try { await fs.writeFile(destination, body, { flag: 'wx' }); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    return destination;
  }
  get(location: string) { return fs.readFile(location); }
  async exists(location: string) { try { await fs.access(location); return true; } catch { return false; } }
}

const root = process.env.OBJECT_STORAGE_LOCAL_DIR ?? process.env.DATASET_STORAGE_DIR ?? path.resolve(process.cwd(), 'storage/objects');
export const objectStorage: ObjectStorage = new LocalObjectStorage(root);
