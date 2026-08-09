describe('env config', () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
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
});
