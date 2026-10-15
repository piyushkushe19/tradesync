export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ConflictError extends AppError {
  constructor(message, details) {
    super(409, 'SYNC_IN_PROGRESS', message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'A required backing service is unavailable. Please retry shortly.') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}

/** Raised by the exchange client. `retryable` tells the worker whether BullMQ should retry. */
export class ExchangeError extends Error {
  constructor(message, { retryable = true, status } = {}) {
    super(message);
    this.name = 'ExchangeError';
    this.retryable = retryable;
    this.status = status;
  }
}
