/**
 * Real GPS + EXIF service.
 *
 *  - readCurrentGps(): gets last known device location via @react-native-community/geolocation
 *  - extractGpsFromExif(): reads EXIF GPS tags from the captured JPEG via react-native-fs
 *  - captureGps(): fallback strategy — try EXIF first, then current GPS
 */

import Geolocation from '@react-native-community/geolocation';
import RNFS from 'react-native-fs';

export interface GpsCoords {
  lat: number;
  lng: number;
}

export type GpsSource = 'device' | 'exif' | 'none';

/**
 * Read the device's current GPS position.
 *
 * Real impl: requests a single high-accuracy fix from Android LocationManager.
 * Requires ACCESS_FINE_LOCATION (already declared in AndroidManifest.xml).
 *
 * Returns null if permission denied, location unavailable, or fix timed out.
 */
export async function readCurrentGps(): Promise<GpsCoords | null> {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        console.warn('Geolocation failed:', err.message);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 30000, // accept a fix up to 30s old
      },
    );
  });
}

/**
 * Extract GPS coordinates from the EXIF metadata of a JPEG file.
 *
 * Real impl: reads EXIF tags via react-native-fs streaming + manual parsing
 * (we don't pull in piexifjs — keeps bundle small). EXIF stores GPS as
 * 3 rationals (degrees, minutes, seconds) + reference (N/S, E/W).
 *
 * Returns null if no GPS in EXIF or the file has no EXIF.
 */
export async function extractGpsFromExif(
  photoUri: string,
): Promise<GpsCoords | null> {
  try {
    // Read first ~64KB — EXIF is always in the first few KB of a JPEG
    const path = photoUri.startsWith('file://') ? photoUri.slice(7) : photoUri;
    const buf = await RNFS.readFile(path, 64 * 1024, 'base64');
    const bytes = base64ToBytes(buf);

    // Walk JPEG markers to find APP1 (EXIF)
    let i = 0;
    if (bytes[i++] !== 0xff || bytes[i++] !== 0xd8) return null; // not JPEG

    while (i < bytes.length - 1) {
      if (bytes[i++] !== 0xff) continue;
      const marker = bytes[i++];
      if (marker === 0xe1) {
        // APP1 — EXIF
        const segLen = (bytes[i] << 8) | bytes[i + 1];
        return parseGpsFromExif(bytes.subarray(i + 2, i + segLen));
      } else if (marker === 0xda) {
        return null; // SOS — past metadata
      } else {
        // Skip segment
        const segLen = (bytes[i] << 8) | bytes[i + 1];
        i += segLen;
      }
    }
    return null;
  } catch (e) {
    console.warn('EXIF parse failed:', e);
    return null;
  }
}

/**
 * Capture strategy: try EXIF first (already on the photo), fall back to GPS.
 */
export async function captureGps(photoUri: string): Promise<{
  coords: GpsCoords | null;
  source: GpsSource;
}> {
  const exif = await extractGpsFromExif(photoUri);
  if (exif) return { coords: exif, source: 'exif' };

  const device = await readCurrentGps();
  if (device) return { coords: device, source: 'device' };

  return { coords: null, source: 'none' };
}

// ─── EXIF GPS parser ────────────────────────────────────────────────────────

function parseGpsFromExif(exifBytes: Uint8Array): GpsCoords | null {
  // Skip "Exif\0\0" prefix
  if (
    exifBytes[0] !== 0x45 || exifBytes[1] !== 0x78 ||
    exifBytes[2] !== 0x69 || exifBytes[3] !== 0x66
  ) {
    return null;
  }
  // Big-endian TIFF header at offset 4
  const littleEndian = exifBytes[5] === 0x49;
  const view = new DataView(exifBytes.buffer, exifBytes.byteOffset, exifBytes.byteLength);
  const get16 = (off: number) => view.getUint16(off, littleEndian);
  const get32 = (off: number) => view.getUint32(off, littleEndian);

  const ifd0Offset = get32(4);
  // Walk IFD0 to find GPS IFD pointer (tag 0x8825)
  const numEntries0 = get16(ifd0Offset);
  let gpsIfdOffset = -1;
  for (let n = 0; n < numEntries0; n++) {
    const entryOff = ifd0Offset + 2 + n * 12;
    const tag = get16(entryOff);
    if (tag === 0x8825) {
      gpsIfdOffset = get32(entryOff + 8);
      break;
    }
  }
  if (gpsIfdOffset < 0) return null;

  // Read GPS IFD entries
  const numEntries = get16(gpsIfdOffset);
  let latRef = 'N';
  let lngRef = 'E';
  let latDeg = 0; let latMin = 0; let latSec = 0;
  let lngDeg = 0; let lngMin = 0; let lngSec = 0;

  for (let n = 0; n < numEntries; n++) {
    const entryOff = gpsIfdOffset + 2 + n * 12;
    const tag = get16(entryOff);
    const type = get16(entryOff + 2);
    const count = get32(entryOff + 4);
    const valOff = entryOff + 8;

    if (tag === 0x0001 && type === 2) {
      latRef = String.fromCharCode(exifBytes[valOff]);
    } else if (tag === 0x0003 && type === 2) {
      lngRef = String.fromCharCode(exifBytes[valOff]);
    } else if (tag === 0x0002 && type === 5 && count === 3) {
      latDeg = readRational(view, valOff, 0, littleEndian);
      latMin = readRational(view, valOff, 8, littleEndian);
      latSec = readRational(view, valOff, 16, littleEndian);
    } else if (tag === 0x0004 && type === 5 && count === 3) {
      lngDeg = readRational(view, valOff, 0, littleEndian);
      lngMin = readRational(view, valOff, 8, littleEndian);
      lngSec = readRational(view, valOff, 16, littleEndian);
    }
  }

  let lat = latDeg + latMin / 60 + latSec / 3600;
  let lng = lngDeg + lngMin / 60 + lngSec / 3600;
  if (latRef === 'S') lat = -lat;
  if (lngRef === 'W') lng = -lng;

  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function readRational(view: DataView, offset: number, idx: number, le: boolean): number {
  const num = view.getUint32(offset + idx, le);
  const den = view.getUint32(offset + idx + 4, le);
  return den === 0 ? 0 : num / den;
}

function base64ToBytes(b64: string): Uint8Array {
  // react-native-fs returns base64 without padding sometimes; fix
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padded = clean + '==='.slice((clean.length + 3) % 4);
  // RN polyfills global.btoa/atob; use those
  const bin = global.atob(padded);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
