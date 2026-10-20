import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ id?: unknown }>();
    const response = http.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();
    const requestId = request.id !== undefined ? String(request.id) : undefined;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const original = exception.getResponse();
      body =
        typeof original === 'string'
          ? { message: original }
          : { ...(original as Record<string, unknown>) };
    } else {
      // Details go to the log only, never to the client.
      this.logger.error({ err: exception }, 'Unhandled exception');
    }

    response.status(status).json({ ...body, statusCode: status, requestId });
  }
}
