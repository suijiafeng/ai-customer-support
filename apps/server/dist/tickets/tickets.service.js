var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { LIMITS, TICKET_TRANSITIONS } from '@assistflow/shared';
import { extractInquiryId, hasAny, normalize } from '../rules/rules.js';
import { StoreService } from '../store/store.service.js';
let TicketsService = class TicketsService {
    store;
    tickets = [];
    ticketById = new Map();
    ticketsBySession = new Map();
    constructor(store) {
        this.store = store;
    }
    async onModuleInit() {
        await this.store.whenReady;
        for (const ticket of this.store.getPersisted().tickets) {
            this.insertTicket(ticket);
        }
    }
    insertTicket(ticket) {
        this.tickets.push(ticket);
        this.ticketById.set(ticket.id, ticket);
        const set = this.ticketsBySession.get(ticket.sessionId);
        if (set) {
            set.add(ticket);
        }
        else {
            this.ticketsBySession.set(ticket.sessionId, new Set([ticket]));
        }
    }
    evictOldest() {
        const oldest = this.tickets.shift();
        if (!oldest)
            return;
        this.ticketById.delete(oldest.id);
        const set = this.ticketsBySession.get(oldest.sessionId);
        if (set) {
            set.delete(oldest);
            if (set.size === 0)
                this.ticketsBySession.delete(oldest.sessionId);
        }
    }
    list() {
        return this.tickets.slice().reverse();
    }
    get all() {
        return this.tickets;
    }
    findById(ticketId) {
        return this.ticketById.get(ticketId);
    }
    getLatestForSession(sessionId) {
        const set = this.ticketsBySession.get(sessionId);
        if (!set || set.size === 0)
            return null;
        return [...set].reduce((latest, t) => new Date(t.updatedAt) > new Date(latest.updatedAt) ? t : latest);
    }
    canTransition(currentStatus, nextStatus) {
        return TICKET_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
    }
    create(params) {
        const { sessionId, message, intent, reason, inquiry } = params;
        const inquiryId = inquiry?.id || extractInquiryId(message) || null;
        const set = this.ticketsBySession.get(sessionId);
        const existingTicket = (set &&
            [...set].find((ticket) => ticket.status === 'open' && ticket.intent === intent && ticket.inquiryId === inquiryId)) ||
            undefined;
        if (existingTicket) {
            existingTicket.lastMessage = message;
            existingTicket.reason = reason;
            existingTicket.updatedAt = new Date().toISOString();
            this.store.saveTicket(existingTicket);
            return existingTicket;
        }
        const priority = hasAny(normalize(message), ['紧急', '尽快', '马上', '今天联系']) ? 'high' : 'normal';
        const ticket = {
            id: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
            sessionId,
            status: 'open',
            priority,
            intent,
            reason,
            inquiryId,
            lastMessage: message,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.insertTicket(ticket);
        while (this.tickets.length > LIMITS.MAX_TICKETS)
            this.evictOldest();
        this.store.saveTicket(ticket);
        return ticket;
    }
    update(ticket, updates = {}) {
        const now = new Date().toISOString();
        if (updates.status)
            ticket.status = updates.status;
        if (updates.priority)
            ticket.priority = updates.priority;
        if (typeof updates.resolution === 'string' && updates.resolution.trim()) {
            ticket.resolution = updates.resolution.trim().slice(0, 120);
        }
        ticket.updatedAt = now;
        if (ticket.status === 'processing' && !ticket.acceptedAt)
            ticket.acceptedAt = now;
        if (ticket.status === 'resolved')
            ticket.resolvedAt = ticket.resolvedAt || now;
        this.store.saveTicket(ticket);
        return ticket;
    }
    addNote(ticket, note) {
        const entry = {
            id: randomUUID(),
            agentId: note.agentId,
            agentName: note.agentName,
            text: note.text.trim().slice(0, 500),
            createdAt: new Date().toISOString(),
        };
        ticket.notes = [...(ticket.notes || []), entry].slice(-50);
        ticket.updatedAt = entry.createdAt;
        this.store.saveTicket(ticket);
        return ticket;
    }
    moveOpenToProcessing(sessionId) {
        const set = this.ticketsBySession.get(sessionId);
        const ticket = (set && [...set].find((item) => item.status === 'open')) ?? null;
        if (!ticket)
            return null;
        return this.update(ticket, { status: 'processing' });
    }
    resolveForSession(sessionId, resolution) {
        const set = this.ticketsBySession.get(sessionId) ?? new Set();
        return [...set]
            .filter((ticket) => ticket.status !== 'resolved')
            .map((ticket) => this.update(ticket, { status: 'resolved', resolution }));
    }
};
TicketsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [StoreService])
], TicketsService);
export { TicketsService };
//# sourceMappingURL=tickets.service.js.map