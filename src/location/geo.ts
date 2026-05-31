// ─────────────────────────────────────────────────────────────
// src/location/geo.ts — capture coordinates for an SOS beacon.
//
// GPS works WITHOUT internet (it's satellite, not cellular), so an
// SOS can carry the sender's exact position even when networks are
// down — which is the whole point in an earthquake/flood.
//
// Uses @react-native-community/geolocation. Degrades to null if the
// module isn't linked or permission is denied, so SOS still fires.
// ─────────────────────────────────────────────────────────────
import { PermissionsAndroid, Platform } from 'react-native';

let GeoModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  GeoModule = require('@react-native-community/geolocation').default;
} catch {
  GeoModule = null;
}

export interface GeoFix {
  lat: number;
  lon: number;
  accuracy: number;
}

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/** Best-effort single GPS fix. Resolves null if unavailable. */
export async function getFix(timeoutMs = 8000): Promise<GeoFix | null> {
  if (!GeoModule) return null;
  if (!(await ensurePermission())) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: GeoFix | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    GeoModule.getCurrentPosition(
      (pos: any) =>
        finish({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 0,
        }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
    setTimeout(() => finish(null), timeoutMs + 500);
  });
}

/** Encode a fix compactly for the SOS payload: "lat,lon,acc". */
export const encodeFix = (f: GeoFix): string =>
  `${f.lat.toFixed(5)},${f.lon.toFixed(5)},${Math.round(f.accuracy)}`;

export function parseFix(s: string): GeoFix | null {
  const m = s.match(/(-?\d+\.\d+),(-?\d+\.\d+),(\d+)/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), accuracy: parseInt(m[3], 10) };
}
