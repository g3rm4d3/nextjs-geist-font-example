import type { Region } from 'react-native-maps';
import type { Coordinate } from './locationProvider';

const MIN_DELTA = 0.02;
/** How much padding to add around the two points, as a multiple of the
 * distance between them — enough that both markers (and the straight
 * line drawn between them) sit comfortably inside the frame rather than
 * right at its edge. */
const PADDING_FACTOR = 1.8;

/**
 * A `Region` that keeps both points on screen — the driver's current
 * position and whichever point currently matters (pickup or
 * destination). Used by PickupNavigationScreen and RideScreen instead of
 * `MapView.fitToCoordinates` (an imperative ref call) to stay consistent
 * with how DriverHomeMapScreen already derives its region from state.
 */
export function computeRegionForTwoPoints(a: Coordinate, b: Coordinate): Region {
  return {
    latitude: (a.latitude + b.latitude) / 2,
    longitude: (a.longitude + b.longitude) / 2,
    latitudeDelta: Math.max(Math.abs(a.latitude - b.latitude) * PADDING_FACTOR, MIN_DELTA),
    longitudeDelta: Math.max(Math.abs(a.longitude - b.longitude) * PADDING_FACTOR, MIN_DELTA),
  };
}
