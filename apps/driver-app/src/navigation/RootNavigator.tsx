import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActiveRideProvider } from '../context/ActiveRideContext';
import { useAuth } from '../context/AuthContext';
import { DriverProfileProvider } from '../context/DriverProfileContext';
import { ApplicationStatusScreen } from '../screens/ApplicationStatusScreen';
import { ArrivalScreen } from '../screens/ArrivalScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { DocumentsScreen } from '../screens/DocumentsScreen';
import { DriverHomeMapScreen } from '../screens/DriverHomeMapScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { IncomingRequestScreen } from '../screens/IncomingRequestScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { PickupNavigationScreen } from '../screens/PickupNavigationScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { RideCompleteScreen } from '../screens/RideCompleteScreen';
import { RideScreen } from '../screens/RideScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SplashScreen } from '../screens/SplashScreen';
import { SupportScreen } from '../screens/SupportScreen';
import { VehicleScreen } from '../screens/VehicleScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: '#1c1917' },
  headerTintColor: '#fafaf9',
  headerTitleStyle: { color: '#fafaf9' },
  contentStyle: { backgroundColor: '#1c1917' },
} as const;

/**
 * One stack, screens conditional on AuthContext.status — same pattern as
 * apps/passenger-app's RootNavigator (Phase 3), the React Navigation-
 * recommended approach for auth flows. DriverProfileProvider and (Phase 9)
 * ActiveRideProvider both wrap the signed-in branch only, so neither
 * fetches/holds anything before a driver session exists.
 */
export function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <SplashScreen />;
  }

  return (
    <DriverProfileProvider>
      <ActiveRideProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
            {status === 'signedOut' ? (
              <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
            ) : (
              <>
                <Stack.Screen
                  name="DriverHomeMap"
                  component={DriverHomeMapScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="Onboarding"
                  component={OnboardingScreen}
                  options={{ title: 'Onboarding' }}
                />
                <Stack.Screen
                  name="Vehicle"
                  component={VehicleScreen}
                  options={{ title: 'Vehicle' }}
                />
                <Stack.Screen
                  name="ApplicationStatus"
                  component={ApplicationStatusScreen}
                  options={{ title: 'Application status' }}
                />
                <Stack.Screen
                  name="Documents"
                  component={DocumentsScreen}
                  options={{ title: 'Documents' }}
                />
                <Stack.Screen
                  name="IncomingRequest"
                  component={IncomingRequestScreen}
                  options={{ title: 'Incoming request' }}
                />
                <Stack.Screen
                  name="PickupNavigation"
                  component={PickupNavigationScreen}
                  options={{ title: 'Pickup navigation' }}
                />
                <Stack.Screen
                  name="Arrival"
                  component={ArrivalScreen}
                  options={{ title: 'Arrival' }}
                />
                <Stack.Screen name="Ride" component={RideScreen} options={{ title: 'Ride' }} />
                <Stack.Screen
                  name="RideComplete"
                  component={RideCompleteScreen}
                  options={{ title: 'Ride complete' }}
                />
                <Stack.Screen
                  name="Earnings"
                  component={EarningsScreen}
                  options={{ title: 'Earnings' }}
                />
                <Stack.Screen
                  name="History"
                  component={HistoryScreen}
                  options={{ title: 'History' }}
                />
                <Stack.Screen
                  name="Profile"
                  component={ProfileScreen}
                  options={{ title: 'Profile' }}
                />
                <Stack.Screen
                  name="Support"
                  component={SupportScreen}
                  options={{ title: 'Support' }}
                />
                <Stack.Screen
                  name="Settings"
                  component={SettingsScreen}
                  options={{ title: 'Settings' }}
                />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </ActiveRideProvider>
    </DriverProfileProvider>
  );
}
