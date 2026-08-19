import { z } from 'zod';

/** POST /notifications/push-token. `token` is an opaque Expo push
 * token string (`ExponentPushToken[...]` for the real provider) —
 * validated for shape/length only, never parsed, since a MOCK
 * environment's tokens are arbitrary test strings. */
export const registerPushTokenSchema = z.object({
  token: z.string().trim().min(1).max(512),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
