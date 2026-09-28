import { NextFunction, Request, Response } from 'express';

export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  req.log?.error({ err }, 'unhandled_error');
  return res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' });
}
