// What the .docx tests need to look inside a file: read a stored zip back, and check that a piece of XML is
// well formed (every tag closed in order, no bare &). Written against the zip format, not against docx-writer.js.

import { crc32 } from 'node:zlib';

/** `{ name: Uint8Array }` for every entry of a stored zip; throws if a signature or a checksum is wrong. */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) {
    throw new Error('no end-of-directory record');
  }
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) {
      throw new Error('bad central directory entry');
    }
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(local, true) !== 0x04034b50) {
      throw new Error(`bad local header for ${name}`);
    }
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataAt, dataAt + size);
    if (method !== 0) {
      throw new Error(`${name} is compressed`);
    }
    if (crc32(data) !== crc) {
      throw new Error(`checksum of ${name} does not match`);
    }
    files[name] = data;
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

export const text = (bytes) => new TextDecoder().decode(bytes);

/** Throws unless the XML is well formed: tags nested and closed in order, and every & part of an entity. */
export function assertWellFormed(xml, label = 'xml') {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(body)) {
    throw new Error(`${label}: a bare &`);
  }
  const stack = [];
  for (const match of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^<>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) {
      continue;
    }
    if (closing) {
      if (stack.pop() !== name) {
        throw new Error(`${label}: </${name}> does not close the open tag`);
      }
    } else {
      stack.push(name);
    }
  }
  if (stack.length) {
    throw new Error(`${label}: <${stack.at(-1)}> is never closed`);
  }
  if (/<[^A-Za-z/?!]/.test(body)) {
    throw new Error(`${label}: a stray <`);
  }
}
