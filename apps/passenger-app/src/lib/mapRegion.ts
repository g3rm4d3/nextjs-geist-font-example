import type { Region } from 'react-native-maps';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

const MIN_DELTA = 0.02;
/** How much padding to add around the two points, as a multiple of the
 * distance between them — enough that both markers (and the straight
 * line drawn between them) sit comfortably inside the frame rather than
 * right at its edge. */
const PADDING_FACTOR = 1.8;

/**
 * A `Region` that keeps both points on screen — the assigned driver's
 * current position and the pickup/destination point that currently
 * matters. Duplicated from apps/driver-app's identical helper rather
 * than shared: these are two independent app packages with no existing
 * cross-app UI code (see docs/architecture.md), and this is six lines of
 * pure geometry, not domain logic that could drift out of sync in a way
 * that matters.
 */
export function computeRegionForTwoPoints(a: Coordinate, b: Coordinate): Region {
  return {
    latitude: (a.latitude + b.latitude) / 2,
    longitude: (a.longitude + b.longitude) / 2,
    latitudeDelta: Math.max(Math.abs(a.latitude - b.latitude) * PADDING_FACTOR, MIN_DELTA),
    longitudeDelta: Math.max(Math.abs(a.longitude - b.longitude) * PADDING_FACTOR, MIN_DELTA),
  };
}
