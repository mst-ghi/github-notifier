import type { IpcErrorCode, IpcErrorPayload } from './types/ipc';

/** Error carrying a stable machine-readable code across the IPC boundary. */
export class AppError extends Error {
  public readonly code: IpcErrorCode;
  public readonly cause?: unknown;

  constructor(code: IpcErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static from(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }
    if (error instanceof Error) {
      return new AppError('UNKNOWN', error.message, error);
    }
    return new AppError('UNKNOWN', String(error));
  }

  toPayload(includeStack: boolean): IpcErrorPayload {
    const payload: IpcErrorPayload = { message: this.message, code: this.code };
    if (includeStack && this.stack) {
      payload.stack = this.stack;
    }
    return payload;
  }
}

/** Narrow an unknown value to something with a `message` string. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown };
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(error);
}

/** Read `status` off an unknown thrown value (Octokit's RequestError shape). */
export function errorStatus(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error as { status: unknown };
    if (typeof status === 'number') {
      return status;
    }
  }
  return null;
}
