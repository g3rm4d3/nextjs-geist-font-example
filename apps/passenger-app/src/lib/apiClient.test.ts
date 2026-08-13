import {
  ApiClientError,
  createRideRequest,
  getRidePayment,
  getRideRatings,
  login,
  previewRoute,
  submitDriverRating,
  updateDefaultPaymentMethod,
} from './apiClient';

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

  it('POSTs a ride request with the idempotency key in the body', async () => {
    const mockRide = {
      id: 'ride_1',
      status: 'SEARCHING_DRIVER',
      pickup: { coordinate: { latitude: 0, longitude: 0 }, label: 'Home' },
      destination: { coordinate: { latitude: 1, longitude: 1 }, label: 'Work' },
      estimatedDistanceMeters: 1000,
      estimatedDurationSeconds: 120,
      estimatedFareCents: 865,
      requestedAt: new Date().toISOString(),
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: mockRide, requestId: 'req_4' }),
    }) as unknown as typeof fetch;

    const input = {
      pickup: { coordinate: { latitude: 0, longitude: 0 }, label: 'Home' },
      destination: { coordinate: { latitude: 1, longitude: 1 }, label: 'Work' },
      idempotencyKey: 'idem-key-1',
    };
    const result = await createRideRequest('token-123', input);

    expect(result).toEqual(mockRide);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rides'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: JSON.stringify(input),
      }),
    );
  });

  it('GETs a ride payment with the ride id in the path', async () => {
    const mockPayment = {
      id: 'pay_1',
      rideId: 'ride_1',
      status: 'SUCCEEDED',
      amountCents: 865,
      currency: 'usd',
      failureReason: null,
      refundedAt: null,
      refundReason: null,
      createdAt: new Date().toISOString(),
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: mockPayment, requestId: 'req_5' }),
    }) as unknown as typeof fetch;

    const result = await getRidePayment('token-123', 'ride_1');

    expect(result).toEqual(mockPayment);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rides/ride_1/payment'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('PATCHes the default test payment method', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ success: true, data: { updated: true }, requestId: 'req_6' }),
    }) as unknown as typeof fetch;

    const result = await updateDefaultPaymentMethod('token-123', {
      testPaymentMethodId: 'pm_card_visa',
    });

    expect(result).toEqual({ updated: true });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/passengers/me/payment-method'),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: JSON.stringify({ testPaymentMethodId: 'pm_card_visa' }),
      }),
    );
  });

  it('POSTs a driver rating with stars and an optional comment', async () => {
    const mockRating = {
      id: 'rating_1',
      rideId: 'ride_1',
      direction: 'PASSENGER_TO_DRIVER',
      stars: 5,
      comment: 'Great ride!',
      createdAt: new Date().toISOString(),
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: mockRating, requestId: 'req_7' }),
    }) as unknown as typeof fetch;

    const result = await submitDriverRating('token-123', 'ride_1', {
      stars: 5,
      comment: 'Great ride!',
    });

    expect(result).toEqual(mockRating);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rides/ride_1/rating'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: JSON.stringify({ stars: 5, comment: 'Great ride!' }),
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
      expect.stringContaining('/rides/ride_1/ratings'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });
});
