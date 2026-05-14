import { Request, Response, NextFunction } from 'express';
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}]: ${message}${extras}`;
          })
        )
  ),
  transports: [new winston.transports.Console()],
});

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? {},
      },
    });
    return;
  }

  // Zod validation errors bubble up as plain errors with a specific shape
  if (err.name === 'ZodError') {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Ongeldige invoer',
        details: JSON.parse(err.message),
      },
    });
    return;
  }

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Er is een interne serverfout opgetreden',
      details: {},
    },
  });
}
