/**
 * The caller identity + request context every mutating admin service
 * function needs to pass through to auditService.recordAuditLog.
 * Defined once here so every admin*Service.ts file uses the exact same
 * shape rather than each redeclaring an equivalent inline type — routes
 * build this straight from `req.auth`/`req.requestId`/`req.ip`.
 */
export interface AuditActorContext {
  userId: string;
  role: string;
  requestId?: string | null;
  ipAddress?: string | null;
}
