import {
  ArgumentsHost,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';

function setup() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-12345678' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  const error = jest.fn();
  const filter = new AllExceptionsFilter({ error } as unknown as PinoLogger);
  return { filter, host, status, json, error };
}

describe('AllExceptionsFilter', () => {
  it('keeps the status of HTTP exceptions and adds the request id', () => {
    const { filter, host, status, json, error } = setup();
    filter.catch(new BadRequestException('bad input'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'bad input',
        requestId: 'req-12345678',
      }),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps a custom body such as the readiness checks', () => {
    const { filter, host, status, json } = setup();
    filter.catch(
      new ServiceUnavailableException({
        status: 'error',
        checks: { database: 'down' },
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        checks: { database: 'down' },
        statusCode: 503,
      }),
    );
  });

  it('hides details of unexpected errors and logs them', () => {
    const { filter, host, status, json, error } = setup();
    filter.catch(new Error('secret db detail'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      message: 'Internal server error',
      statusCode: 500,
      requestId: 'req-12345678',
    });
    expect(error).toHaveBeenCalled();
  });

  it('turns body-parser errors into a 400 without logging them', () => {
    const { filter, host, status, json, error } = setup();
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      statusCode: 400,
    });
    filter.catch(parseError, host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      message: 'Invalid request',
      statusCode: 400,
      requestId: 'req-12345678',
    });
    expect(error).not.toHaveBeenCalled();
  });
});
