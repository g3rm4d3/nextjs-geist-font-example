/**
 * Shared API envelope types.
 *
 * Every backend endpoint responds with one of these shapes so that all three
 * client applications (passenger, driver, admin) can parse responses the
 * same way, and so error handling is centralized rather than re-implemented
 * per client.
 */

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  /** Correlates this response with server-side logs and audit records. */
  requestId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    /** Stable machine-readable error code, e.g. "VALIDATION_ERROR". */
    code: string;
    message: string;
    /** Optional field-level validation details (e.g. from Zod). */
    details?: Record<string, string[]>;
  };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
