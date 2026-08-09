describe('env config', () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const originalMockGps = process.env.EXPO_PUBLIC_MOCK_GPS;
  const originalMockLat = process.env.EXPO_PUBLIC_MOCK_GPS_LAT;
  const originalMockLng = process.env.EXPO_PUBLIC_MOCK_GPS_LNG;

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    process.env.EXPO_PUBLIC_MOCK_GPS = originalMockGps;
    process.env.EXPO_PUBLIC_MOCK_GPS_LAT = originalMockLat;
    process.env.EXPO_PUBLIC_MOCK_GPS_LNG = originalMockLng;
  });

  it('defaults to localhost when EXPO_PUBLIC_API_URL is not set', () => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_API_URL;

    // require() (not import) is intentional: it re-evaluates the module
    // after jest.resetModules(), which a hoisted static import would not.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('./env');
    expect(env.apiUrl).toBe('http://localhost:4000');
  });

  it('uses EXPO_PUBLIC_API_URL when it is set', () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.dev';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('./env');
    expect(env.apiUrl).toBe('https://api.example.dev');
  });

  it('defaults mockGpsEnabled to false and uses a fallback coordinate', () => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_MOCK_GPS;
    delete process.env.EXPO_PUBLIC_MOCK_GPS_LAT;
    delete process.env.EXPO_PUBLIC_MOCK_GPS_LNG;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('./env');
    expect(env.mockGpsEnabled).toBe(false);
    expect(env.mockGpsCoordinate).toEqual({ latitude: 39.7684, longitude: -86.158 });
  });

  it('enables mock GPS and parses a configured coordinate', () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_MOCK_GPS = 'true';
    process.env.EXPO_PUBLIC_MOCK_GPS_LAT = '40.7128';
    process.env.EXPO_PUBLIC_MOCK_GPS_LNG = '-74.006';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('./env');
    expect(env.mockGpsEnabled).toBe(true);
    expect(env.mockGpsCoordinate).toEqual({ latitude: 40.7128, longitude: -74.006 });
  });

  it('falls back to the default coordinate for an unparseable value', () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_MOCK_GPS_LAT = 'not-a-number';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('./env');
    expect(env.mockGpsCoordinate.latitude).toBe(39.7684);
  });
});
