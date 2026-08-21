import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OfflineBanner } from '../components/OfflineBanner';
import { PushTokenRegistrar } from '../components/PushTokenRegistrar';
import { useAuth } from '../context/AuthContext';
import { RideDraftProvider } from '../context/RideDraftContext';
import { AuthScreen } from '../screens/AuthScreen';
import { DestinationSearchScreen } from '../screens/DestinationSearchScreen';
import { DriverAssignedScreen } from '../screens/DriverAssignedScreen';
import { HomeMapScreen } from '../screens/HomeMapScreen';
import { NewSupportTicketScreen } from '../screens/NewSupportTicketScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { PaymentMethodsScreen } from '../screens/PaymentMethodsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { RequestRideScreen } from '../screens/RequestRideScreen';
import { RideCompleteScreen } from '../screens/RideCompleteScreen';
import { RideDetailsScreen } from '../screens/RideDetailsScreen';
import { RideEstimateScreen } from '../screens/RideEstimateScreen';
import { RideHistoryScreen } from '../screens/RideHistoryScreen';
import { RideTrackingScreen } from '../screens/RideTrackingScreen';
import { RoutePreviewScreen } from '../screens/RoutePreviewScreen';
import { SearchingDriverScreen } from '../screens/SearchingDriverScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SplashScreen } from '../screens/SplashScreen';
import { SupportScreen } from '../screens/SupportScreen';
import { SupportTicketDetailScreen } from '../screens/SupportTicketDetailScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: '#0f172a' },
  headerTintColor: '#f8fafc',
  headerTitleStyle: { color: '#f8fafc' },
  contentStyle: { backgroundColor: '#0f172a' },
} as const;

/**
 * One stack, screens conditional on AuthContext.status — the pattern
 * React Navigation itself recommends for auth flows, rather than
 * switching between two separate Navigators. An unauthenticated user
 * only ever sees Auth; every other screen requires a signed-in
 * passenger, so there is no code path that renders a ride-flow screen
 * without a valid session.
 */
export function RootNavigator() {
  const { status, accessToken } = useAuth();

  if (status === 'loading') {
    return <SplashScreen />;
  }

  return (
    <RideDraftProvider>
      {status === 'signedIn' && accessToken && <PushTokenRegistrar accessToken={accessToken} />}
      <OfflineBanner />
      <NavigationContainer>
        <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
          {status === 'signedOut' ? (
            <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen
                name="HomeMap"
                component={HomeMapScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="DestinationSearch"
                component={DestinationSearchScreen}
                options={{ title: 'Where to?' }}
              />
              <Stack.Screen
                name="RoutePreview"
                component={RoutePreviewScreen}
                options={{ title: 'Route preview' }}
              />
              <Stack.Screen
                name="RideEstimate"
                component={RideEstimateScreen}
                options={{ title: 'Ride estimate' }}
              />
              <Stack.Screen
                name="RequestRide"
                component={RequestRideScreen}
                options={{ title: 'Request ride' }}
              />
              <Stack.Screen
                name="SearchingDriver"
                component={SearchingDriverScreen}
                options={{ title: 'Searching' }}
              />
              <Stack.Screen
                name="DriverAssigned"
                component={DriverAssignedScreen}
                options={{ title: 'Your driver' }}
              />
              <Stack.Screen
                name="RideTracking"
                component={RideTrackingScreen}
                options={{ title: 'Your ride' }}
              />
              <Stack.Screen
                name="RideComplete"
                component={RideCompleteScreen}
                options={{ title: 'Ride complete' }}
              />
              <Stack.Screen
                name="RideHistory"
                component={RideHistoryScreen}
                options={{ title: 'Ride history' }}
              />
              <Stack.Screen
                name="RideDetails"
                component={RideDetailsScreen}
                options={{ title: 'Ride details' }}
              />
              <Stack.Screen
                name="Profile"
                component={ProfileScreen}
                options={{ title: 'Profile' }}
              />
              <Stack.Screen
                name="PaymentMethods"
                component={PaymentMethodsScreen}
                options={{ title: 'Payment methods' }}
              />
              <Stack.Screen
                name="Support"
                component={SupportScreen}
                options={{ title: 'Support' }}
              />
              <Stack.Screen
                name="NewSupportTicket"
                component={NewSupportTicketScreen}
                options={{ title: 'New ticket' }}
              />
              <Stack.Screen
                name="SupportTicketDetail"
                component={SupportTicketDetailScreen}
                options={{ title: 'Ticket' }}
              />
              <Stack.Screen
                name="Settings"
                component={SettingsScreen}
                options={{ title: 'Settings' }}
              />
              <Stack.Screen
                name="Notifications"
                component={NotificationsScreen}
                options={{ title: 'Notifications' }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </RideDraftProvider>
  );
}
