var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ForbiddenException, Injectable } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service.js';
import { SseService } from '../sse/sse.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
let SessionTicketService = class SessionTicketService {
    sessions;
    tickets;
    sse;
    constructor(sessions, tickets, sse) {
        this.sessions = sessions;
        this.tickets = tickets;
        this.sse = sse;
    }
    notify(sessionId) {
        this.sse.notifySession(sessionId, this.sessions.getSessionPayload(sessionId));
        this.sse.notifyQueue(this.sessions.getSessionsPayload());
    }
    resolvedTicketsForSession(sessionId) {
        return this.tickets.all.filter((t) => t.sessionId === sessionId && t.status === 'resolved');
    }
    resolveSessionTickets(sessionId, resolution) {
        return this.tickets.resolveForSession(sessionId, resolution);
    }
    advanceTicketOnFirstReply(sessionId) {
        return this.tickets.moveOpenToProcessing(sessionId);
    }
    withOwner(ticket) {
        const session = this.sessions.get(ticket.sessionId);
        return {
            ...ticket,
            ownerAgentId: session?.assignedAgentId ?? null,
            ownerAgentName: session?.assignedAgentName ?? null,
        };
    }
    assertCanOperate(ticket, agent) {
        if (agent.role === 'admin')
            return;
        const ownerId = this.sessions.get(ticket.sessionId)?.assignedAgentId ?? null;
        if (ownerId !== null && ownerId !== agent.id) {
            throw new ForbiddenException({ error: 'ticket belongs to another agent' });
        }
    }
    syncTicketToSession(ticket) {
        return this.sessions.syncFromTicket(ticket);
    }
};
SessionTicketService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [SessionsService,
        TicketsService,
        SseService])
], SessionTicketService);
export { SessionTicketService };
//# sourceMappingURL=session-ticket.service.js.map