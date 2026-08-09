import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatusCard } from './SystemStatusCard';

describe('SystemStatusCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows connected status when the API and database are healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              status: 'ok',
              timestamp: new Date().toISOString(),
              uptimeSeconds: 5,
              database: { connected: true, latencyMs: 2 },
            },
            requestId: 'req_1',
          }),
      }),
    );

    render(<SystemStatusCard />);

    await waitFor(() => expect(screen.getByTestId('status-ok')).toBeInTheDocument());
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('shows an error state when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    render(<SystemStatusCard />);

    await waitFor(() => expect(screen.getByTestId('status-error')).toBeInTheDocument());
  });
});
