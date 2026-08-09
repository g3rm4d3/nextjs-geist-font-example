import { ApiClientError, login, previewRoute } from './apiClient';

describe('apiClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves with data on a successful response', async () => {
    const mockUser = { id: 'usr_1', email: 'jane@example.com', role: 'PASSENGER', isActive: true };
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

    const result = await login({ email: 'jane@example.com', password: 'abcd1234' });

    expect(result.user).toEqual(mockUser);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'jane@example.com', password: 'abcd1234' }),
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

    await expect(login({ email: 'jane@example.com', password: 'wrong' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password',
    });
    await expect(login({ email: 'jane@example.com', password: 'wrong' })).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  it('sends the access token as a Bearer header for authenticated calls', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          data: { distanceMeters: 1000, durationSeconds: 120 },
          requestId: 'req_3',
        }),
    }) as unknown as typeof fetch;

    await previewRoute('token-123', {
      origin: { latitude: 0, longitude: 0 },
      destination: { latitude: 1, longitude: 1 },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/routes/preview'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });
});
