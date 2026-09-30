export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'UNPROCESSABLE', details);
  }
}

/**
 * A trial that has run out.
 *
 * Distinct from a plain 403 so the front end can show an upgrade screen rather
 * than a permissions error — the account is valid, its window has closed.
 */
/**
 * The account holds a password somebody else chose and must replace it before
 * it can do anything. Its own code, so the front end can route to the change
 * screen instead of showing a dead end.
 */
export class PasswordChangeRequiredError extends AppError {
  constructor(message = 'Set your own password before continuing.') {
    super(message, 403, 'PASSWORD_CHANGE_REQUIRED');
  }
}

export class TrialExpiredError extends AppError {
  constructor(endedAt: Date) {
    super(
      `This trial ended on ${endedAt.toISOString().slice(0, 10)}. Get in touch to keep the account going — nothing has been deleted.`,
      403,
      'TRIAL_EXPIRED',
      { endedAt },
    );
  }
}
