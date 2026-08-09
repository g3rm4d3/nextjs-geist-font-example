import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useAuth } from '../context/AuthContext';
import { useDriverProfile } from '../context/DriverProfileContext';
import { ApiClientError, setAvailability } from '../lib/apiClient';
import {
  getLocationProvider,
  type Coordinate,
  type LocationPermissionState,
} from '../lib/locationProvider';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'DriverHomeMap'>;

const FALLBACK_REGION: Region = {
  latitude: 39.7684,
  longitude: -86.158,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

/**
 * The driver's main authenticated landing screen. Phase 5's core
 * requirement — approved drivers can go OFFLINE -> ONLINE, non-approved
 * drivers cannot — is implemented as a single toggle here rather than
 * separate "Go Online"/"Go Offline" screens (see docs/driver-app.md):
 * that's how the availability control actually behaves in the spec's
 * own model, a state a driver flips, not a place they navigate to.
 *
 * Position comes from lib/locationProvider — real GPS via expo-location,
 * or a configurable mock (EXPO_PUBLIC_MOCK_GPS) — satisfying "support
 * real GPS and configurable mock GPS during development". Nothing here
 * sends this position to the server yet; that's Phase 6 (Location
 * Infrastructure).
 */
export function DriverHomeMapScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { profile, setProfile } = useDriverProfile();
  const [coordinate, setCoordinate] = useState<Coordinate | null>(null);
  const [permission, setPermission] = useState<LocationPermissionState | null>(null);
  const [isTogglingAvailability, setIsTogglingAvailability] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const provider = getLocationProvider();

    async function resolveInitialLocation() {
      const result = await provider.getCurrentLocation();
      if (cancelled) return;
      setCoordinate(result.coordinate);
      setPermission(result.permission);
    }

    void resolveInitialLocation();

    const unsubscribe = provider.watchLocation((next) => {
      if (!cancelled) setCoordinate(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function handleToggleAvailability() {
    if (!accessToken || !profile) return;
    setErrorMessage(null);
    setIsTogglingAvailability(true);

    try {
      const nextStatus = profile.availabilityStatus === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
      const updated = await setAvailability(accessToken, { status: nextStatus });
      setProfile(updated);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not update your availability.',
      );
    } finally {
      setIsTogglingAvailability(false);
    }
  }

  const region: Region = coordinate
    ? { ...coordinate, latitudeDelta: 0.02, longitudeDelta: 0.02 }
    : FALLBACK_REGION;
  const isApproved = profile?.onboardingStatus === 'APPROVED';
  const isOnline = profile?.availabilityStatus === 'ONLINE';

  return (
    <View style={styles.container}>
      <MapView style={styles.map} region={region}>
        {coordinate && <Marker coordinate={coordinate} title="You" pinColor="#fbbf24" />}
      </MapView>

      <View style={styles.topBar}>
        <Pressable
          style={styles.profileButton}
          onPress={() => navigation.navigate('Profile')}
          testID="profile-button"
        >
          <Text style={styles.profileButtonText}>👤</Text>
        </Pressable>
        {profile && (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{profile.availabilityStatus}</Text>
          </View>
        )}
      </View>

      {permission === 'denied' && (
        <View style={styles.permissionBanner}>
          <Text style={styles.permissionBannerText}>
            Location permission denied — showing an approximate area instead of your real position.
          </Text>
        </View>
      )}

      {!isApproved && (
        <Pressable
          style={styles.approvalBanner}
          onPress={() => navigation.navigate('ApplicationStatus')}
          testID="approval-banner"
        >
          <Text style={styles.approvalBannerText}>
            Complete onboarding to go online — tap to check your application status.
          </Text>
        </Pressable>
      )}

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      <Pressable
        style={[
          styles.availabilityButton,
          isOnline ? styles.availabilityButtonOnline : styles.availabilityButtonOffline,
          (!isApproved || isTogglingAvailability) && styles.availabilityButtonDisabled,
        ]}
        onPress={handleToggleAvailability}
        disabled={!isApproved || isTogglingAvailability}
        testID="toggle-availability-button"
      >
        {isTogglingAvailability ? (
          <ActivityIndicator color="#1c1917" />
        ) : (
          <Text style={styles.availabilityButtonText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917' },
  map: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#292524',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileButtonText: { fontSize: 18 },
  statusChip: {
    backgroundColor: '#292524',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusChipText: { color: '#fbbf24', fontSize: 12, fontWeight: '700' },
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
  approvalBanner: {
    position: 'absolute',
    top: 112,
    left: 16,
    right: 16,
    backgroundColor: '#292524',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#57534e',
  },
  approvalBannerText: { color: '#fafaf9', fontSize: 13 },
  errorText: {
    position: 'absolute',
    bottom: 96,
    left: 16,
    right: 16,
    color: '#f87171',
    textAlign: 'center',
  },
  availabilityButton: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  availabilityButtonOffline: { backgroundColor: '#fbbf24' },
  availabilityButtonOnline: { backgroundColor: '#4ade80' },
  availabilityButtonDisabled: { opacity: 0.4 },
  availabilityButtonText: { color: '#1c1917', fontSize: 16, fontWeight: '700' },
});
