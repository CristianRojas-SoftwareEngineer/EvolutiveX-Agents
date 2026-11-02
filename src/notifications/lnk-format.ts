// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Lector y parcheador de `IconLocation` en archivos `.lnk` (Shell Link Binary
// File Format, MS-SHLLINK) escrito 100% en TypeScript. Sin COM, sin PowerShell,
// sin `child_process.exec`. Operaciones de `Buffer` puro, bounds-checked por
// Node.js (no hay riesgo de buffer overflow).
//
// Por qué existe: `SnoreToast -install` crea el `.lnk` en el Menú Inicio de
// Windows con `IPropertyStore` (`AppUserModelID` + `ToastActivatorCLSID`), pero
// no asigna `IconLocation`, por lo que el header del toast hereda el icono
// genérico del ejecutable de SnoreToast. `patchIconLocation` inyecta o
// reemplaza `IconLocation` en el `.lnk` ya generado y `parseIconLocation`
// permite a `register.ts` verificar la idempotencia en `--install` y `--status`.
//
// Spec de referencia:
//   https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-shllink/

// --- Constantes del formato ---

const HEADER_SIZE = 0x4c;
const LINK_CLSID_BYTES = Buffer.from([
  0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x46,
]);

// --- Helpers de codificación ---

function encodeUtf16Le(s: string): Buffer {
  // UTF-16LE sin BOM. `s.length` en JS cuenta code units UTF-16, que es
  // exactamente lo que necesitamos (BMP characters).
  const buf = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    buf.writeUInt16LE(s.charCodeAt(i), i * 2);
  }
  return buf;
}

function buildCountedUnicodeString(s: string): Buffer {
  // MS-SHLLINK §2.4 StringData: "Count" es el número de UTF-16 code
  // units INCLUYENDO el null terminator. El null también es UTF-16 (2
  // bytes). Total de bytes = (s.length + 1) * 2.
  const count = s.length + 1;
  const countBuf = Buffer.alloc(2);
  countBuf.writeUInt16LE(count, 0);
  const strBuf = encodeUtf16Le(s);
  const nullBuf = Buffer.from([0, 0]);
  return Buffer.concat([countBuf, strBuf, nullBuf]);
}

// --- Parser y parcheador (para idempotencia, --install y --status) ---

function parseLinkFlags(lnk: Buffer): number {
  return lnk.readUInt32LE(0x14);
}

function skipLinkTargetIdList(lnk: Buffer, offset: number): number {
  // IDList: secuencia de ItemIDs terminada por un ItemID de 2 bytes (0x0000).
  // Cada ItemID: cb (2 bytes, little-endian) + abID (cb-2 bytes).
  while (offset < lnk.length) {
    const cb = lnk.readUInt16LE(offset);
    if (cb === 0) {
      return offset + 2;
    }
    offset += cb;
  }
  throw new Error(".lnk truncado dentro de LinkTargetIDList");
}

function skipLinkInfo(lnk: Buffer, offset: number): number {
  const size = lnk.readUInt32LE(offset);
  if (size < 0x1c || offset + size > lnk.length) {
    throw new Error("LinkInfo inválido o truncado");
  }
  return offset + size;
}

function readCountedString(
  lnk: Buffer,
  offset: number,
  isUnicode: boolean,
): { value: string; nextOffset: number } {
  const count = lnk.readUInt16LE(offset);
  const bytes = count * (isUnicode ? 2 : 1);
  if (offset + 2 + bytes > lnk.length) {
    throw new Error("StringData truncado");
  }
  let value = "";
  if (isUnicode) {
    for (let i = 0; i < count - 1; i++) {
      value += String.fromCharCode(lnk.readUInt16LE(offset + 2 + i * 2));
    }
  } else {
    value = lnk.toString("latin1", offset + 2, offset + 2 + count - 1);
  }
  return { value, nextOffset: offset + 2 + bytes };
}

function skipCountedString(
  lnk: Buffer,
  offset: number,
  isUnicode: boolean,
): number {
  return readCountedString(lnk, offset, isUnicode).nextOffset;
}

/**
 * Lee `IconLocation` del `.lnk` (p. ej. `C:\\path\\icon.ico,1`).
 * Devuelve `undefined` si el archivo no es un shell link válido o no
 * tiene `HasIconLocation`.
 */
export function parseIconLocation(lnk: Buffer): string | undefined {
  if (lnk.length < HEADER_SIZE) return undefined;
  if (lnk.readUInt32LE(0) !== HEADER_SIZE) return undefined;
  if (!lnk.slice(0x04, 0x14).equals(LINK_CLSID_BYTES)) return undefined;

  const flags = parseLinkFlags(lnk);
  if ((flags & 0x40) === 0) return undefined;

  let offset = HEADER_SIZE;
  if ((flags & 0x01) !== 0) {
    offset = skipLinkTargetIdList(lnk, offset);
  }
  if ((flags & 0x02) !== 0) {
    offset = skipLinkInfo(lnk, offset);
  }

  const isUnicode = (flags & 0x80) !== 0;
  try {
    if ((flags & 0x04) !== 0) {
      offset = skipCountedString(lnk, offset, isUnicode);
    }
    for (const bit of [0x08, 0x10, 0x20] as const) {
      if ((flags & bit) !== 0) {
        offset = skipCountedString(lnk, offset, isUnicode);
      }
    }
    if ((flags & 0x40) !== 0) {
      return readCountedString(lnk, offset, isUnicode).value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Inserta o reemplaza `IconLocation` en un `.lnk` existente (p. ej. creado por
 * SnoreToast `-install`, que deja el icono del target = SnoreToast genérico).
 * Añade `HasIconLocation` al header si faltaba.
 */
export function patchIconLocation(lnk: Buffer, iconLocation: string): Buffer {
  if (lnk.length < HEADER_SIZE) {
    throw new Error(".lnk demasiado corto");
  }
  if (lnk.readUInt32LE(0) !== HEADER_SIZE) {
    throw new Error("HeaderSize inválido");
  }
  if (!lnk.slice(0x04, 0x14).equals(LINK_CLSID_BYTES)) {
    throw new Error("LinkCLSID inválido");
  }

  const flags = parseLinkFlags(lnk);
  const isUnicode = (flags & 0x80) !== 0;
  if (!isUnicode) {
    throw new Error("Solo se soporta parche de IconLocation en .lnk Unicode");
  }

  let offset = HEADER_SIZE;
  if ((flags & 0x01) !== 0) {
    offset = skipLinkTargetIdList(lnk, offset);
  }
  if ((flags & 0x02) !== 0) {
    offset = skipLinkInfo(lnk, offset);
  }

  const stringFlagBits = [0x04, 0x08, 0x10, 0x20, 0x40] as const;
  let insertAt = offset;
  for (const bit of stringFlagBits) {
    if ((flags & bit) === 0) {
      if (bit === 0x40) {
        insertAt = offset;
        break;
      }
      continue;
    }
    if (bit === 0x40) {
      const count = lnk.readUInt16LE(offset);
      const oldTotal = 2 + count * 2;
      const patched = Buffer.from(lnk);
      patched.writeUInt32LE(flags, 0x14);
      const newIcon = buildCountedUnicodeString(iconLocation);
      const before = patched.subarray(0, offset);
      const after = patched.subarray(offset + oldTotal);
      return Buffer.concat([before, newIcon, after]);
    }
    offset = skipCountedString(lnk, offset, isUnicode);
    insertAt = offset;
  }

  const patched = Buffer.from(lnk);
  patched.writeUInt32LE(flags | 0x40, 0x14);
  const newIcon = buildCountedUnicodeString(iconLocation);
  const before = patched.subarray(0, insertAt);
  const after = patched.subarray(insertAt);
  return Buffer.concat([before, newIcon, after]);
}
