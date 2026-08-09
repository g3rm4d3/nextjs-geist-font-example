/**
 * Full Phase 3 screen list (spec). Most carry no params — the in-progress
 * ride draft (pickup/destination) lives in RideDraftContext instead of
 * being threaded through navigation params across half a dozen screens.
 */
export type RootStackParamList = {
  Splash: undefined;
  Auth: undefined;
  HomeMap: undefined;
  DestinationSearch: undefined;
  RoutePreview: undefined;
  RideEstimate: undefined;
  RequestRide: undefined;
  SearchingDriver: undefined;
  DriverAssigned: undefined;
  RideTracking: undefined;
  RideComplete: undefined;
  RideHistory: undefined;
  RideDetails: { rideId: string };
  Profile: undefined;
  PaymentMethods: undefined;
  Support: undefined;
  Settings: undefined;
};

declare global {
  namespace ReactNavigation {
    // The React Navigation-recommended pattern for typing the root
    // navigator globally — an empty-looking interface is the point here,
    // it's declaration merging, not a type that needs its own members.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
