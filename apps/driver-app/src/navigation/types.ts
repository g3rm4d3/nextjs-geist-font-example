/**
 * Full Phase 5 screen list (spec), with one deliberate collapsing: "Go
 * Online" / "Go Offline" are not separate routes here — they're a single
 * availability toggle rendered on Driver Home Map (see docs/driver-app.md
 * for why). Everything else in the spec's list gets its own screen.
 */
export type RootStackParamList = {
  Splash: undefined;
  Auth: undefined;
  Onboarding: undefined;
  Vehicle: undefined;
  ApplicationStatus: undefined;
  DriverHomeMap: undefined;
  Documents: undefined;
  IncomingRequest: undefined;
  PickupNavigation: undefined;
  Arrival: undefined;
  Ride: undefined;
  RideComplete: undefined;
  Earnings: undefined;
  History: undefined;
  Profile: undefined;
  Support: undefined;
  NewSupportTicket: undefined;
  SupportTicketDetail: { ticketId: string };
  Settings: undefined;
  Notifications: undefined;
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
