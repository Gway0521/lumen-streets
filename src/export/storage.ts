import { BufferTarget, StreamTarget } from 'mediabunny';
import { VIDEO_LIMITS } from './framing.ts';

export const hasVideoStorage = () => typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
/** Estimates are advisory; quota can change while another tab writes. */
export async function videoStorageAvailable(large: boolean, expectedBytes: number) {
  if (!hasVideoStorage()) return !large && expectedBytes <= VIDEO_LIMITS.memoryBytes;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return quota === undefined || usage === undefined || quota - usage >= expectedBytes;
  } catch { return true; }
}
/** Each job owns one temporary file. Never enumerate or remove another job's files. */
export async function videoStorage(large: boolean) {
  if (!hasVideoStorage()) {
    if (large) throw new Error('VIDEO_STORAGE_UNAVAILABLE');
    const target = new BufferTarget();
    return { target, limit: VIDEO_LIMITS.memoryBytes, file: async (type: string) => {
      if (!target.buffer) throw new Error('Video output missing');
      return new Blob([target.buffer], { type });
    }, release: async () => {} };
  }
  let directory: FileSystemDirectoryHandle | undefined, name: string | undefined, writable: FileSystemWritableFileStream | undefined;
  try {
    directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('lumen-streets-exports', { create: true });
    name = `capture-${crypto.randomUUID()}`;
    const handle = await directory.getFileHandle(name, { create: true });
    writable = await handle.createWritable();
    let released = false;
    const release = async () => {
      if (released) return; released = true;
      await writable!.abort().catch(() => {});
      await directory!.removeEntry(name!).catch(() => {});
    };
    return { target: new StreamTarget(writable, { chunked: true, chunkSize: 2 ** 20 }), limit: VIDEO_LIMITS.bytes,
      file: async (type: string) => (await handle.getFile()).slice(0, undefined, type), release };
  } catch {
    await writable?.abort().catch(() => {});
    if (directory && name) await directory.removeEntry(name).catch(() => {});
    throw new Error('VIDEO_STORAGE_UNAVAILABLE');
  }
}
