/** Errors thrown by any layer. The API error handler turns them into JSON responses. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const tooManyRequests = (message = 'Too many requests, please try again later') =>
  new AppError(429, 'TOO_MANY_REQUESTS', message);

/**
 * Translate PostgreSQL errors (constraint violations, trigger RAISEs) into safe API errors.
 * The database enforces most business rules — this keeps those messages user-friendly
 * without leaking SQL or table internals.
 */
export function fromDatabaseError(err: unknown): AppError | null {
  const e = err as { code?: string; constraint?: string; message?: string; detail?: string };
  if (!e || typeof e.code !== 'string') return null;
  switch (e.code) {
    case '23505': // unique_violation
      return conflict('A record with the same unique value already exists', { constraint: e.constraint });
    case '23503': // foreign_key_violation
      return badRequest('A referenced record does not exist or is still in use', { constraint: e.constraint });
    case '23514': // check_violation
    case '23P01': // exclusion_violation
      return badRequest('The data violates a business rule', { constraint: e.constraint });
    case '23502': // not_null_violation
      return badRequest('A required value is missing');
    case '22P02': // invalid_text_representation
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
      return badRequest('Invalid value format');
    case '22001': // string_data_right_truncation (e.g. a long prefix setting overflowing a VARCHAR)
      return badRequest('A value is too long');
    case '22003': // numeric_value_out_of_range
      return badRequest('A number is out of range');
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new AppError(409, 'RETRY', 'The record was changed by someone else at the same time — please retry');
    case '57014': // query_canceled (statement_timeout)
      return new AppError(503, 'TIMEOUT', 'The request took too long — please try again or narrow it down');
    case 'P0001': // RAISE EXCEPTION from our triggers — messages are written by us and safe to show
      return badRequest(e.message ?? 'Business rule violated');
    default:
      return null;
  }
}
