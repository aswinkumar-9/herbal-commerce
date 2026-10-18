import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // Liveness: the process is running.
  @Get()
  live() {
    return { status: 'ok' };
  }

  // Readiness: the dependencies the API needs are reachable.
  @Get('ready')
  async ready() {
    const checks = await this.health.checkAll();
    const ok = Object.values(checks).every((check) => check === 'up');
    const body = { status: ok ? 'ok' : 'error', checks };
    if (!ok) {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
