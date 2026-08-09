import { ApiClientError, login, reportLocation, setAvailability } from './apiClient';

describe('apiClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves with data on a successful response', async () => {
    const mockUser = {
      id: 'usr_1',
      email: 'dana@example.com',
      role: 'DRIVER',
      isActive: true,
      driverOnboardingStatus: 'DRAFT',
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            user: mockUser,
            tokens: { accessToken: 'a', refreshToken: 'b', accessTokenExpiresInSeconds: 900 },
          },
          requestId: 'req_1',
        }),
    }) as unknown as typeof fetch;

    const result = await login({ email: 'dana@example.com', password: 'abcd1234' });

    expect(result.user).toEqual(mockUser);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'dana@example.com', password: 'abcd1234' }),
      }),
    );
  });

  it('throws ApiClientError with the server error code on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
          requestId: 'req_2',
        }),
    }) as unknown as typeof fetch;

    await expect(login({ email: 'dana@example.com', password: 'wrong' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password',
    });
    await expect(login({ email: 'dana@example.com', password: 'wrong' })).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  it('PATCHes availability with the access token as a Bearer header', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          data: { onboardingStatus: 'APPROVED', availabilityStatus: 'ONLINE', vehicle: null },
          requestId: 'req_3',
        }),
    }) as unknown as typeof fetch;

    await setAvailability('token-123', { status: 'ONLINE' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/drivers/me/availability'),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: JSON.stringify({ status: 'ONLINE' }),
      }),
    );
  });

  it('POSTs a location ping and resolves with written/location', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            written: true,
            location: {
              latitude: 40.7128,
              longitude: -74.006,
              heading: 90,
              speed: 5,
              accuracy: 10,
              recordedAt: '2026-01-01T00:00:00.000Z',
              isStale: false,
            },
          },
          requestId: 'req_4',
        }),
    }) as unknown as typeof fetch;

    const result = await reportLocation('token-123', { latitude: 40.7128, longitude: -74.006 });

    expect(result.written).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/drivers/me/location'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: JSON.stringify({ latitude: 40.7128, longitude: -74.006 }),
      }),
    );
  });
});
