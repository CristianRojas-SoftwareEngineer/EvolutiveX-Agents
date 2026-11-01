// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2026 Cristián Rojas Arredondo.
// SPDX-License-Identifier: MPL-2.0

// Generador y parser de archivos `.lnk` (Shell Link Binary File Format,
// MS-SHLLINK) escrito 100% en TypeScript. Sin COM, sin PowerShell, sin
// `child_process.exec`. Operaciones de `Buffer` puro, bounds-checked por
// Node.js (no hay riesgo de buffer overflow).
//
// Por qué existe: el helper `register.ts` necesita crear un `.lnk` en el
// Menú Inicio de Windows con la propiedad `AppUserModelID` en su
// `ExtraData` (signature `0xA0000005`, introducida en Windows 7
// precisamente para que las apps UWP registren su AUMID en un shortcut).
// `IPropertyStore` (la API estándar para escribir `System.AppUser.Model.ID`
// en un `.lnk`) es IUnknown-only y no se puede invocar desde PowerShell
// inline. Escribir el `.lnk` byte a byte desde Node.js es la vía
// TypeScript-only: Self-contained, testeable sin subprocess, sin
// dependencia npm.
//
// Spec de referencia:
//   https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-shllink/
//
// Estructura generada (orden):
//   SHELL_LINK_HEADER (76 bytes)
//   LINK_INFO (con VolumeIDOffset=0; LocalBasePath + LocalBasePathUnicode)
//   NAME_STRING (CountedString UTF-16LE)
//   ICON_LOCATION (CountedString UTF-16LE)
//   APP_USER_MODEL_ID_BLOCK (ExtraData; signature 0xA0000005)
//   Terminator (4 bytes 0x00)
//
// LinkFlags activos:
//   0x00000002 HasLinkInfo
//   0x00000004 HasName
//   0x00000040 HasIconLocation
//   0x00000080 IsUnicode
// (No usamos LinkTargetIDList; LinkInfo.LocalBasePath es suficiente
//  para que Windows resuelva un archivo local.)

// --- Constantes del formato ---

const HEADER_SIZE = 0x4c;
const LINK_CLSID_BYTES = Buffer.from([
  0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x46,
]);
const APP_USER_MODEL_ID_SIGNATURE = 0xa0000005;
const SW_SHOWNORMAL = 1;
const FILE_ATTRIBUTE_NORMAL = 0x80;

// LinkFlags activos.
const LINK_FLAGS =
  0x00000002 | // HasLinkInfo
  0x00000004 | // HasName
  0x00000040 | // HasIconLocation
  0x00000080; // IsUnicode

// LinkInfoFlags: VolumeIDAndLocalBasePath | LocalBasePathUnicode.
const LINK_INFO_FLAGS = 0x01 | 0x80;

// --- Helpers de codificación ---

function encodeUtf16Le(s: string): Buffer {
  // UTF-16LE sin BOM. `s.length` en JS cuenta code units UTF-16, que es
  // exactamente lo que necesitamos (BMP characters). No manejamos
  // surrogate pairs porque los paths Windows y los AUMIDs son BMP-only.
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

// --- Bloques del .lnk ---

function buildShellLinkHeader(): Buffer {
  // 76 bytes. Seteamos solo lo esencial: HeaderSize, LinkCLSID, LinkFlags,
  // IconIndex=0, ShowCommand=SW_SHOWNORMAL. Tiempos y FileSize en 0
  // (Windows no los usa para resolver).
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.writeUInt32LE(HEADER_SIZE, 0x00);
  LINK_CLSID_BYTES.copy(buf, 0x04);
  buf.writeUInt32LE(LINK_FLAGS, 0x14);
  buf.writeUInt32LE(FILE_ATTRIBUTE_NORMAL, 0x18);
  // CreationTime/AccessTime/WriteTime = 0 (no usados para resolución)
  // FileSize = 0
  buf.writeUInt32LE(0, 0x38); // IconIndex
  buf.writeUInt32LE(SW_SHOWNORMAL, 0x3c); // ShowCommand
  // HotKey/Reserved1/Reserved2/Reserved3 = 0
  return buf;
}

function buildLinkInfo(localPath: string): Buffer {
  // MS-SHLLINK §2.3 LINKINFO. HeaderSize fijo 0x1C (28 bytes).
  // VolumeIDOffset = 0 (sin VolumeID). LocalBasePath empieza en 0x1C.
  // LocalBasePathUnicode (UTF-16LE null-terminated) sigue al ANSI path.
  const ansiPath = Buffer.from(localPath, "latin1");
  const ansiPathNull = Buffer.concat([ansiPath, Buffer.from([0])]);
  const unicodePathNull = Buffer.concat([
    encodeUtf16Le(localPath),
    Buffer.from([0, 0]),
  ]);

  const linkInfoSize = 0x1c + ansiPathNull.length + unicodePathNull.length;
  const buf = Buffer.alloc(linkInfoSize);
  buf.writeUInt32LE(linkInfoSize, 0x00);
  buf.writeUInt32LE(0x1c, 0x04); // LinkInfoHeaderSize
  buf.writeUInt32LE(LINK_INFO_FLAGS, 0x08);
  buf.writeUInt32LE(0, 0x0c); // VolumeIDOffset = 0 (sin VolumeID)
  buf.writeUInt32LE(0x1c, 0x10); // LocalBasePathOffset
  buf.writeUInt32LE(0, 0x14); // CommonNetworkRelativeLinkOffset = 0
  buf.writeUInt32LE(0x1c, 0x18); // CommonPathSuffixOffset = mismo path
  ansiPathNull.copy(buf, 0x1c);
  unicodePathNull.copy(buf, 0x1c + ansiPathNull.length);
  return buf;
}

function buildAppUserModelIdBlock(aumid: string): Buffer {
  // MS-SHLLINK §2.5.7 APP_USER_MODEL_ID.
  // BlockSize = 8 (BlockSize + BlockSignature) + bytes del AUMID UTF-16LE.
  // No null terminator al final (BlockSize delimita el bloque).
  const aumidBuf = encodeUtf16Le(aumid);
  const blockSize = 8 + aumidBuf.length;
  const buf = Buffer.alloc(blockSize);
  buf.writeUInt32LE(blockSize, 0);
  buf.writeUInt32LE(APP_USER_MODEL_ID_SIGNATURE, 4);
  aumidBuf.copy(buf, 8);
  return buf;
}

export interface ShortcutArgs {
  target: string; // ruta absoluta al .exe (LocalBasePath)
  icon: string; // ruta al .ico + ",0" (IconLocation)
  name: string; // DisplayName (NAME_STRING)
  aumid: string; // AppUserModelID
}

export function buildShortcutBytes(args: ShortcutArgs): Buffer {
  const header = buildShellLinkHeader();
  const linkInfo = buildLinkInfo(args.target);
  const nameString = buildCountedUnicodeString(args.name);
  const iconString = buildCountedUnicodeString(args.icon);
  const aumidBlock = buildAppUserModelIdBlock(args.aumid);
  const terminator = Buffer.from([0, 0, 0, 0]);
  return Buffer.concat([
    header,
    linkInfo,
    nameString,
    iconString,
    aumidBlock,
    terminator,
  ]);
}

// --- Parser (para idempotencia y --status) ---

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

function skipStringData(lnk: Buffer, offset: number, flags: number): number {
  const isUnicode = (flags & 0x80) !== 0;
  // Orden: NAME_STRING, RELATIVE_PATH, WORKING_DIR, COMMAND_LINE_ARGUMENTS, ICON_LOCATION
  const stringFlagBits = [0x04, 0x08, 0x10, 0x20, 0x40];
  for (const bit of stringFlagBits) {
    if ((flags & bit) !== 0) {
      offset = skipCountedString(lnk, offset, isUnicode);
    }
  }
  return offset;
}

function readAppUserModelIdFromExtraData(
  lnk: Buffer,
  offset: number,
): string | undefined {
  // Recorre bloques de ExtraData hasta encontrar terminator (BlockSize < 4).
  // Cada bloque: BlockSize (4) + BlockSignature (4) + payload variable.
  while (offset <= lnk.length - 8) {
    const blockSize = lnk.readUInt32LE(offset);
    if (blockSize < 4) {
      return undefined; // terminator alcanzado
    }
    const blockSignature = lnk.readUInt32LE(offset + 4);
    if (blockSignature === APP_USER_MODEL_ID_SIGNATURE) {
      const aumidLen = blockSize - 8;
      if (aumidLen <= 0 || offset + 8 + aumidLen > lnk.length) {
        return undefined;
      }
      let aumid = "";
      for (let i = 0; i < aumidLen; i += 2) {
        aumid += String.fromCharCode(lnk.readUInt16LE(offset + 8 + i));
      }
      return aumid;
    }
    offset += blockSize;
  }
  return undefined;
}

function offsetAfterStringData(lnk: Buffer): number | undefined {
  if (lnk.length < HEADER_SIZE) return undefined;
  if (lnk.readUInt32LE(0) !== HEADER_SIZE) return undefined;
  if (!lnk.slice(0x04, 0x14).equals(LINK_CLSID_BYTES)) return undefined;

  const flags = parseLinkFlags(lnk);
  let offset = HEADER_SIZE;

  if ((flags & 0x01) !== 0) {
    offset = skipLinkTargetIdList(lnk, offset);
  }
  if ((flags & 0x02) !== 0) {
    offset = skipLinkInfo(lnk, offset);
  }
  return skipStringData(lnk, offset, flags);
}

/**
 * Lee `IconLocation` del `.lnk` (p. ej. `C:\\path\\icon.ico,0`).
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

export function parseAppUserModelId(lnk: Buffer): string | undefined {
  const offset = offsetAfterStringData(lnk);
  if (offset === undefined) return undefined;
  return readAppUserModelIdFromExtraData(lnk, offset);
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
