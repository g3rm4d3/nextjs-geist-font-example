describe('locationProvider (mock mode)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.useRealTimers();
  });

  it('resolves getCurrentLocation with the configured mock coordinate', async () => {
    jest.resetModules();
    jest.doMock('../config/env', () => ({
      env: {
        apiUrl: 'http://localhost:4000',
        mockGpsEnabled: true,
        mockGpsCoordinate: { latitude: 40.7128, longitude: -74.006 },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocationProvider } = require('./locationProvider');
    const provider = getLocationProvider();
    const result = await provider.getCurrentLocation();

    expect(result).toEqual({
      coordinate: { latitude: 40.7128, longitude: -74.006 },
      permission: 'granted',
    });
  });

  it('watchLocation ticks with drifting coordinates until unsubscribed', () => {
    jest.useFakeTimers();
    jest.resetModules();
    jest.doMock('../config/env', () => ({
      env: {
        apiUrl: 'http://localhost:4000',
        mockGpsEnabled: true,
        mockGpsCoordinate: { latitude: 40.7128, longitude: -74.006 },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocationProvider } = require('./locationProvider');
    const provider = getLocationProvider();

    const updates: { latitude: number; longitude: number }[] = [];
    const unsubscribe = provider.watchLocation((coordinate: { latitude: number; longitude: number }) =>
      updates.push(coordinate),
    );

    jest.advanceTimersByTime(4000);
    jest.advanceTimersByTime(4000);
    expect(updates).toHaveLength(2);
    // Drift is a small random nudge, not a teleport.
    expect(Math.abs(updates[0]!.latitude - 40.7128)).toBeLessThan(0.001);

    unsubscribe();
    jest.advanceTimersByTime(4000);
    expect(updates).toHaveLength(2); // no further ticks after unsubscribing
  });
});
