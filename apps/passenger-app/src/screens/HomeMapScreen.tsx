import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useRideDraft } from '../context/RideDraftContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'HomeMap'>;

// A generic fallback center used when location permission is denied or
// unavailable, so the map always has somewhere to show rather than
// failing outright — the passenger can still drag the pickup pin
// manually. Not meant to represent any real service area.
const FALLBACK_REGION: Region = {
  latitude: 39.7684,
  longitude: -86.158,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

type LocationPermissionState = 'checking' | 'granted' | 'denied';

export function HomeMapScreen({ navigation }: Props) {
  const { pickup, destination, setPickup } = useRideDraft();
  const [region, setRegion] = useState<Region>(FALLBACK_REGION);
  const [permissionState, setPermissionState] = useState<LocationPermissionState>('checking');

  useEffect(() => {
    let cancelled = false;

    async function resolveCurrentLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        if (!cancelled) setPermissionState('denied');
        return;
      }

      if (!cancelled) setPermissionState('granted');

      try {
        const position = await Location.getCurrentPositionAsync({});
        if (cancelled) return;

        const currentRegion: Region = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        };
        setRegion(currentRegion);

        if (!pickup) {
          setPickup({
            coordinate: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            },
            label: 'Current location',
          });
        }
      } catch {
        // GPS unavailable (simulator with no location set, indoors, etc.)
        // — fall back to a manually-draggable pin on the default region.
        if (!cancelled && !pickup) {
          setPickup({ coordinate: FALLBACK_REGION, label: 'Pickup location' });
        }
      }
    }

    void resolveCurrentLocation();
    return () => {
      cancelled = true;
    };
    // Deliberately runs once on mount only — re-resolving GPS on every
    // pickup change would fight the user dragging the pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={region} region={pickup ? undefined : region}>
        {pickup && (
          <Marker
            coordinate={pickup.coordinate}
            draggable
            title="Pickup"
            pinColor="#22c55e"
            onDragEnd={(event) =>
              setPickup({ coordinate: event.nativeEvent.coordinate, label: 'Pickup location' })
            }
          />
        )}
        {destination && (
          <Marker coordinate={destination.coordinate} title="Destination" pinColor="#ef4444" />
        )}
      </MapView>

      <View style={styles.topBar}>
        <Pressable
          style={styles.profileButton}
          onPress={() => navigation.navigate('Profile')}
          testID="profile-button"
        >
          <Text style={styles.profileButtonText}>👤</Text>
        </Pressable>

        <Pressable
          style={styles.destinationBar}
          onPress={() => navigation.navigate('DestinationSearch')}
          testID="where-to-button"
        >
          <Text style={styles.destinationBarText}>
            {destination ? destination.label : 'Where to?'}
          </Text>
        </Pressable>
      </View>

      {permissionState === 'denied' && (
        <View style={styles.permissionBanner}>
          <Text style={styles.permissionBannerText}>
            Location permission denied — drag the green pin to set your pickup point manually.
          </Text>
        </View>
      )}

      {pickup && destination && (
        <Pressable
          style={styles.previewButton}
          onPress={() => navigation.navigate('RoutePreview')}
          testID="preview-route-button"
        >
          <Text style={styles.previewButtonText}>Preview route</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  profileButtonText: { fontSize: 18 },
  destinationBar: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  destinationBarText: { color: '#0f172a', fontSize: 15, fontWeight: '600' },
  permissionBanner: {
    position: 'absolute',
    top: 112,
    left: 16,
    right: 16,
    backgroundColor: '#78350f',
    borderRadius: 8,
    padding: 12,
  },
  permissionBannerText: { color: '#fef3c7', fontSize: 13 },
  previewButton: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  previewButtonText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
});
