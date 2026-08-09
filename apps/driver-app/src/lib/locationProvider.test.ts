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

    expect(result.permission).toBe('granted');
    expect(result.sample).toMatchObject({ latitude: 40.7128, longitude: -74.006 });
    expect(typeof result.sample.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(result.sample.timestamp))).toBe(false);
  });

  it('watchLocation ticks with drifting, plausible samples until unsubscribed', () => {
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

    interface Sample {
      latitude: number;
      longitude: number;
      heading?: number;
      speed?: number;
      accuracy?: number;
      timestamp: string;
    }
    const updates: Sample[] = [];
    const unsubscribe = provider.watchLocation((sample: Sample) => updates.push(sample));

    jest.advanceTimersByTime(4000);
    jest.advanceTimersByTime(4000);
    expect(updates).toHaveLength(2);
    // Drift is a small random nudge, not a teleport.
    expect(Math.abs(updates[0]!.latitude - 40.7128)).toBeLessThan(0.001);
    // Every sample looks like a moving vehicle, not a bare coordinate.
    expect(updates[0]!.heading).toBeGreaterThanOrEqual(0);
    expect(updates[0]!.heading).toBeLessThanOrEqual(360);
    expect(updates[0]!.speed).toBeGreaterThan(0);
    expect(updates[0]!.accuracy).toBeGreaterThan(0);

    unsubscribe();
    jest.advanceTimersByTime(4000);
    expect(updates).toHaveLength(2); // no further ticks after unsubscribing
  });
});
