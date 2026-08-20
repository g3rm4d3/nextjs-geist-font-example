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

/**
 * Shape returned by the API's GET /ready endpoint (Phase 22) — distinct
 * from GET /health above on purpose. Liveness ("is the process up")
 * always answers 200; readiness ("can this instance actually serve
 * traffic right now") answers 503 the moment a hard dependency — today,
 * just the database — is unreachable, so an orchestrator/load balancer
 * can route around an instance that's running but can't do useful work,
 * instead of sending it requests it can only fail.
 */
export interface ReadinessCheckResponse {
  status: 'ready' | 'not_ready';
  timestamp: string;
  database: {
    connected: boolean;
    latencyMs: number | null;
  };
}
