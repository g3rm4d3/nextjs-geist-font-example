import { schema } from '@rideshare/database';

/** Single source of truth: the same enum Postgres enforces on `users.role`. */
export type UserRole = (typeof schema.userRoleEnum.enumValues)[number];
