var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Req, UseGuards, } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { SessionTicketService } from '../workflow/session-ticket.service.js';
import { TicketsService } from './tickets.service.js';
let TicketsController = class TicketsController {
    tickets;
    workflow;
    metrics;
    constructor(tickets, workflow, metrics) {
        this.tickets = tickets;
        this.workflow = workflow;
        this.metrics = metrics;
    }
    listTickets(req) {
        const agent = req.agent;
        const all = this.tickets.list().map((t) => this.workflow.withOwner(t));
        // 普通客服可见：自己的 + 未认领（池中）；管理员可见全部
        const scoped = agent.role === 'admin'
            ? all
            : all.filter((t) => t.ownerAgentId === agent.id || t.ownerAgentId == null);
        return { tickets: scoped };
    }
    addNote(ticketId, body, req) {
        const agent = req.agent;
        const ticket = this.tickets.findById(ticketId);
        if (!ticket) {
            throw new NotFoundException({ error: 'ticket not found' });
        }
        this.workflow.assertCanOperate(ticket, agent);
        const text = String(body?.text || '').trim();
        if (!text) {
            throw new BadRequestException({ error: 'note text required' });
        }
        const updated = this.tickets.addNote(ticket, { agentId: agent.id, agentName: agent.name, text });
        return { ticket: this.workflow.withOwner(updated) };
    }
    updateTicket(ticketId, body, req) {
        const ticket = this.tickets.findById(ticketId);
        if (!ticket) {
            throw new NotFoundException({ error: 'ticket not found' });
        }
        this.workflow.assertCanOperate(ticket, req.agent);
        const nextStatus = body?.status ? String(body.status) : ticket.status;
        const nextPriority = body?.priority ? String(body.priority) : ticket.priority;
        if (!['open', 'processing', 'resolved'].includes(nextStatus)) {
            throw new BadRequestException({ error: 'invalid ticket status' });
        }
        if (!this.tickets.canTransition(ticket.status, nextStatus)) {
            throw new ConflictException({
                error: 'invalid ticket transition',
                currentStatus: ticket.status,
                nextStatus,
            });
        }
        if (!['normal', 'high'].includes(nextPriority)) {
            throw new BadRequestException({ error: 'invalid ticket priority' });
        }
        const updatedTicket = this.tickets.update(ticket, {
            status: nextStatus,
            priority: nextPriority,
            resolution: body?.resolution,
        });
        const session = this.workflow.syncTicketToSession(updatedTicket);
        this.workflow.notify(updatedTicket.sessionId);
        return {
            ticket: this.workflow.withOwner(updatedTicket),
            session,
            metrics: this.metrics.buildMetrics(),
        };
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TicketsController.prototype, "listTickets", null);
__decorate([
    Post(':ticketId/notes'),
    __param(0, Param('ticketId')),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], TicketsController.prototype, "addNote", null);
__decorate([
    Patch(':ticketId'),
    __param(0, Param('ticketId')),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], TicketsController.prototype, "updateTicket", null);
TicketsController = __decorate([
    UseGuards(AgentAuthGuard),
    Controller('api/tickets'),
    __metadata("design:paramtypes", [TicketsService,
        SessionTicketService,
        MetricsService])
], TicketsController);
export { TicketsController };
//# sourceMappingURL=tickets.controller.js.map