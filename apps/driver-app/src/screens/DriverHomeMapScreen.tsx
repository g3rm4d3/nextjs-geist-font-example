import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useAuth } from '../context/AuthContext';
import { useDriverProfile } from '../context/DriverProfileContext';
import { ApiClientError, reportLocation, setAvailability } from '../lib/apiClient';
import {
  getLocationProvider,
  type LocationPermissionState,
  type LocationSample,
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
 * or a configurable mock (EXPO_PUBLIC_MOCK_GPS). Phase 6 wires that
 * position to the server: every sample from the same long-lived watch
 * subscription that drives the map marker is also POSTed to
 * /drivers/me/location, but only while the driver is actually ONLINE,
 * permission is granted, and the app is foregrounded — see the
 * `shouldReport` check below for how each of Phase 6's "handle: stale
 * GPS / missing permissions / network interruption / background-
 * foreground" cases maps to a concrete guard.
 */
export function DriverHomeMapScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { profile, setProfile } = useDriverProfile();
  const [sample, setSample] = useState<LocationSample | null>(null);
  const [permission, setPermission] = useState<LocationPermissionState | null>(null);
  const [isTogglingAvailability, setIsTogglingAvailability] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs mirror state the watchLocation callback below needs to read at
  // call time — that callback is set up once (empty dependency array,
  // since re-subscribing to GPS on every availability/token change would
  // be wasteful) and would otherwise close over stale values.
  const isOnlineRef = useRef(false);
  const permissionRef = useRef<LocationPermissionState | null>(null);
  const accessTokenRef = useRef<string | null>(accessToken);

  useEffect(() => {
    isOnlineRef.current = profile?.availabilityStatus === 'ONLINE';
  }, [profile?.availabilityStatus]);

  useEffect(() => {
    permissionRef.current = permission;
  }, [permission]);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    const provider = getLocationProvider();

    async function resolveInitialLocation() {
      const result = await provider.getCurrentLocation();
      if (cancelled) return;
      setSample(result.sample);
      setPermission(result.permission);
    }

    void resolveInitialLocation();

    const unsubscribe = provider.watchLocation((next) => {
      if (cancelled) return;
      setSample(next);

      // Missing permissions: permissionRef only reads 'granted' once a
      // real fix has actually been obtained (or mock mode, which is
      // always 'granted' — there's no real GPS to lack permission for).
      // Background/foreground: AppState.currentState is checked at send
      // time rather than via a subscription, since all that matters here
      // is "don't call the API right now", not reacting to the
      // transition itself.
      // Network interruption: the POST is fire-and-forget — a failure
      // here just means this one sample never made it; the next watch
      // tick tries again on its own, no retry queue needed for a
      // stream that self-heals every few seconds.
      const shouldReport =
        isOnlineRef.current &&
        permissionRef.current === 'granted' &&
        accessTokenRef.current &&
        AppState.currentState === 'active';

      if (shouldReport && accessTokenRef.current) {
        void reportLocation(accessTokenRef.current, next).catch(() => undefined);
      }
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

  const region: Region = sample
    ? {
        latitude: sample.latitude,
        longitude: sample.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }
    : FALLBACK_REGION;
  const isApproved = profile?.onboardingStatus === 'APPROVED';
  const isOnline = profile?.availabilityStatus === 'ONLINE';

  return (
    <View style={styles.container}>
      <MapView style={styles.map} region={region}>
        {sample && (
          <Marker
            coordinate={{ latitude: sample.latitude, longitude: sample.longitude }}
            title="You"
            pinColor="#fbbf24"
          />
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
        {profile && (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{profile.availabilityStatus}</Text>
          </View>
        )}
      </View>

      {permission === 'denied' && (
        <View style={styles.permissionBanner}>
          <Text style={styles.permissionBannerText}>
            Location permission denied — showing an approximate area, and your position isn&apos;t
            being sent to the server.
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
