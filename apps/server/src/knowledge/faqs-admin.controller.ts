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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { KnowledgeService } from './knowledge.service.js';

/** 知识库运营（工作台「知识库」页）：FAQ 增删改查与导入。仅 admin 可写，列表查询放行给客服。 */
@UseGuards(AgentAuthGuard)
@Controller('api/admin/faqs')
export class FaqsAdminController {
  constructor(private readonly knowledge: KnowledgeService) {}

  private agentOf(req: any): AuthenticatedAgent {
    return req.agent as AuthenticatedAgent;
  }

  private assertAdmin(agent: AuthenticatedAgent) {
    if (agent.role !== 'admin') {
      throw new ForbiddenException({ error: 'admin only' });
    }
  }

  private toError(e: any): never {
    throw new BadRequestException({ error: e?.message || 'invalid faq' });
  }

  /** 运营列表：q 模糊搜问题/关键词，intent 精确筛选。 */
  @Get()
  list(@Query('q') q: string, @Query('intent') intent: string) {
    return { faqs: this.knowledge.searchFaqsAdmin(q, intent), total: this.knowledge.faqs.length };
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    const faq = this.knowledge.faqs.find((f) => f.id === id);
    if (!faq) throw new NotFoundException({ error: 'faq not found' });
    return { faq };
  }

  @Post()
  async create(@Body() body: any, @Req() req: any) {
    this.assertAdmin(this.agentOf(req));
    try {
      return { faq: await this.knowledge.createFaq(body) };
    } catch (e: any) {
      this.toError(e);
    }
  }

  @Post('import')
  async import(@Body() body: any, @Req() req: any) {
    this.assertAdmin(this.agentOf(req));
    const mode = body?.mode === 'replace' ? 'replace' : 'merge';
    try {
      return await this.knowledge.importFaqs(body?.faqs, mode);
    } catch (e: any) {
      this.toError(e);
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    this.assertAdmin(this.agentOf(req));
    try {
      const faq = await this.knowledge.updateFaq(id, body);
      if (!faq) throw new NotFoundException({ error: 'faq not found' });
      return { faq };
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      this.toError(e);
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    this.assertAdmin(this.agentOf(req));
    const ok = await this.knowledge.deleteFaq(id);
    if (!ok) throw new NotFoundException({ error: 'faq not found' });
    return { deleted: true };
  }
}
