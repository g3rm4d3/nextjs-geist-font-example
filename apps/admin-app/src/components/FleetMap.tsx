'use client';

import type { FleetDriverLocation } from '@rideshare/types';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';

// Same fictional city center as the seed data, both mobile apps' mock-GPS
// fallback, and the location simulator (apps/api/scripts/locationSimulator.ts).
const CITY_CENTER: [number, number] = [39.7684, -86.158];

/**
 * A plain colored dot via L.divIcon rather than Leaflet's default marker
 * image — the default PNG icon's asset path resolution famously breaks
 * under bundlers (a well-known Leaflet+Next.js/webpack issue) unless you
 * hand-configure L.Icon.Default with imported URLs. A divIcon sidesteps
 * that entirely and lets color communicate availability status directly.
 */
function markerIcon(entry: FleetDriverLocation): L.DivIcon {
  const color = entry.isStale
    ? '#94a3b8' // slate — stale, don't trust this position
    : entry.availabilityStatus === 'ONLINE'
      ? '#22c55e' // green
      : entry.availabilityStatus === 'BUSY'
        ? '#f59e0b' // amber
        : '#64748b'; // slate-ish — offline

  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.4);"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

interface FleetMapProps {
  locations: FleetDriverLocation[];
}

/**
 * Phase 6: "Admin App should display virtual drivers on map." OpenStreetMap
 * tiles via react-leaflet — free, no API key to provision or verify in
 * this environment (unlike Google Maps, see docs/maps.md's known
 * limitation for the mobile apps' Android tiles).
 */
export function FleetMap({ locations }: FleetMapProps) {
  return (
    <MapContainer center={CITY_CENTER} zoom={12} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {locations.map((entry) => (
        <Marker
          key={entry.driverId}
          position={[entry.latitude, entry.longitude]}
          icon={markerIcon(entry)}
        >
          <Popup>
            <strong>
              {entry.firstName} {entry.lastName}
            </strong>
            <br />
            {entry.availabilityStatus}
            {entry.isStale ? ' (stale)' : ''}
            <br />
            {new Date(entry.recordedAt).toLocaleTimeString()}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
