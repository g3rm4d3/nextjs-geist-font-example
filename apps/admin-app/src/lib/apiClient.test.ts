import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, getFleetLocations, getMe, login } from './apiClient';

describe('apiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with data on a successful login', async () => {
    const mockUser = { id: 'usr_1', email: 'admin@example.com', role: 'ADMIN', isActive: true };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              user: mockUser,
              tokens: { accessToken: 'a', refreshToken: 'b', accessTokenExpiresInSeconds: 900 },
            },
            requestId: 'req_1',
          }),
      }),
    );

    const result = await login({ email: 'admin@example.com', password: 'abcd1234' });

    expect(result.user).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com', password: 'abcd1234' }),
      }),
    );
  });

  it('throws ApiClientError with the server error code on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
            requestId: 'req_2',
          }),
      }),
    );

    await expect(login({ email: 'admin@example.com', password: 'wrong' })).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  it('sends the access token as a Bearer header for GET /auth/me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: 'usr_1', email: 'admin@example.com', role: 'ADMIN', isActive: true },
            requestId: 'req_3',
          }),
      }),
    );

    await getMe('token-123');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/me'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('fetches the fleet locations list', async () => {
    const fleet = [
      {
        driverId: 'drv_1',
        firstName: 'Sim',
        lastName: 'Driver0',
        availabilityStatus: 'ONLINE',
        latitude: 39.77,
        longitude: -86.16,
        heading: null,
        speed: null,
        accuracy: null,
        recordedAt: new Date().toISOString(),
        isStale: false,
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ success: true, data: fleet, requestId: 'req_4' }),
      }),
    );

    const result = await getFleetLocations('token-123');

    expect(result).toEqual(fleet);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/drivers/locations'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });
});
