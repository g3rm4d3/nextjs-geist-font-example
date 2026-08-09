/**
 * Shape returned by the API's GET /health endpoint.
 *
 * `database` is reported separately from overall HTTP status: the process
 * can be up and answering requests (status "ok") while the database is
 * unreachable (database.connected === false), which is itself useful
 * operational signal rather than a reason to fail the health check.
 */
export interface HealthCheckResponse {
  status: 'ok';
  timestamp: string;
  uptimeSeconds: number;
  database: {
    connected: boolean;
    latencyMs: number | null;
  };
}
