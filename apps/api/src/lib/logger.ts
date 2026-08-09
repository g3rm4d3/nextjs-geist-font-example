import { createLogger } from '@rideshare/logging';
import { env } from '../config/env';

export const logger = createLogger({
  service: 'api',
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV !== 'production',
});
