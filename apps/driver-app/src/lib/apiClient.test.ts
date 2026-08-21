import {
  ApiClientError,
  getEarningsHistory,
  getEarningsSummary,
  getRideRatings,
  login,
  reportLocation,
  setAvailability,
  submitPassengerRating,
} from './apiClient';

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

  it('throws a NETWORK_ERROR ApiClientError when fetch itself rejects (Phase 23)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;

    await expect(login({ email: 'dana@example.com', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    await expect(login({ email: 'dana@example.com', password: 'abcd1234' })).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  it('throws a NETWORK_ERROR ApiClientError when the response body is not valid JSON (Phase 23)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    }) as unknown as typeof fetch;

    await expect(login({ email: 'dana@example.com', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
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

  it('GETs the earnings summary', async () => {
    const mockSummary = {
      today: { rideCount: 1, grossFareCents: 1200, platformCommissionCents: 240, driverGrossEarningsCents: 960, adjustmentsCents: 0 },
      week: { rideCount: 3, grossFareCents: 3600, platformCommissionCents: 720, driverGrossEarningsCents: 2880, adjustmentsCents: 0 },
      month: { rideCount: 10, grossFareCents: 12000, platformCommissionCents: 2400, driverGrossEarningsCents: 9600, adjustmentsCents: 0 },
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: mockSummary, requestId: 'req_5' }),
    }) as unknown as typeof fetch;

    const result = await getEarningsSummary('token-123');

    expect(result).toEqual(mockSummary);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/drivers/me/earnings/summary'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('GETs the earnings history', async () => {
    const mockHistory = [
      {
        id: 'de_1',
        rideId: 'ride_1',
        completedAt: '2026-01-01T00:00:00.000Z',
        pickupLabel: 'Home',
        destinationLabel: 'Work',
        grossFareCents: 1200,
        platformCommissionCents: 240,
        driverGrossEarningsCents: 960,
        adjustmentsCents: 0,
        payoutStatus: 'PENDING',
        paymentStatus: 'SUCCEEDED',
      },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: mockHistory, requestId: 'req_6' }),
    }) as unknown as typeof fetch;

    const result = await getEarningsHistory('token-123');

    expect(result).toEqual(mockHistory);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/drivers/me/earnings/history'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('POSTs a passenger rating with stars and an optional comment', async () => {
    const mockRating = {
      id: 'rating_1',
      rideId: 'ride_1',
      direction: 'DRIVER_TO_PASSENGER',
      stars: 4,
      comment: null,
      createdAt: new Date().toISOString(),
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: mockRating, requestId: 'req_7' }),
    }) as unknown as typeof fetch;

    const result = await submitPassengerRating('token-123', 'ride_1', { stars: 4 });

    expect(result).toEqual(mockRating);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/drivers/me/rides/ride_1/rating'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: JSON.stringify({ stars: 4 }),
      }),
    );
  });

  it('GETs both directions of ratings for a ride', async () => {
    const mockRatings = { passengerToDriver: null, driverToPassenger: null };
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: mockRatings, requestId: 'req_8' }),
    }) as unknown as typeof fetch;

    const result = await getRideRatings('token-123', 'ride_1');

    expect(result).toEqual(mockRatings);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/drivers/me/rides/ride_1/ratings'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });
});
