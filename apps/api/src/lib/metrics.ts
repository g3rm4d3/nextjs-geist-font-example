import { createInMemoryMetricsRecorder, type MetricsRecorder } from '@rideshare/observability';

/**
 * Single shared MetricsRecorder for the process — same pattern as
 * errorTracker.ts/notificationProvider.ts. Recorded by
 * middleware/metrics.ts on every response, read by
 * GET /admin/metrics (routes/adminMetrics.ts).
 */
export const metricsRecorder: MetricsRecorder = createInMemoryMetricsRecorder();
