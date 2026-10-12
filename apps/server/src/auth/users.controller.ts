import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentAuthGuard } from './auth.guard.js';
import { AuthService, type AuthenticatedAgent } from './auth.service.js';

/** 用户管理（工作台「用户管理」页）：客服账号增删改查。仅 admin。 */
@UseGuards(AgentAuthGuard)
@Controller('api/admin/users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  private agentOf(req: any): AuthenticatedAgent {
    return req.agent as AuthenticatedAgent;
  }

  private assertAdmin(agent: AuthenticatedAgent) {
    if (agent.role !== 'admin') {
      throw new ForbiddenException({ error: 'admin only' });
    }
  }

  private toError(e: any): never {
    throw new BadRequestException({ error: e?.message || 'invalid user' });
  }

  @Get()
  list(@Req() req: any) {
    this.assertAdmin(this.agentOf(req));
    return { users: this.auth.listAgents() };
  }

  @Post()
  async create(@Body() body: any, @Req() req: any) {
    const agent = this.agentOf(req);
    this.assertAdmin(agent);
    try {
      return { user: await this.auth.createAgent(body) };
    } catch (e: any) {
      this.toError(e);
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const agent = this.agentOf(req);
    this.assertAdmin(agent);
    try {
      const user = await this.auth.updateAgent(id, body, agent.id);
      if (!user) throw new NotFoundException({ error: 'user not found' });
      return { user };
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      this.toError(e);
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    const agent = this.agentOf(req);
    this.assertAdmin(agent);
    try {
      const ok = await this.auth.deleteAgent(id, agent.id);
      if (!ok) throw new NotFoundException({ error: 'user not found' });
      return { deleted: true };
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      this.toError(e);
    }
  }
}
