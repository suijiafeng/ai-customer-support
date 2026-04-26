var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
import { Subject, concat, filter, interval, map, merge, of } from 'rxjs';
let SseService = class SseService {
    sessionEvents$ = new Subject();
    queueEvents$ = new Subject();
    notifySession(sessionId, payload) {
        this.sessionEvents$.next({ sessionId, payload });
    }
    notifyQueue(payload) {
        this.queueEvents$.next(payload);
    }
    sessionStream(sessionId, initial) {
        const updates = this.sessionEvents$.pipe(filter((event) => event.sessionId === sessionId), map((event) => ({ type: 'session', data: event.payload })));
        return concat(of({ type: 'session', data: initial }), merge(updates, heartbeat()));
    }
    queueStream(initial) {
        const updates = this.queueEvents$.pipe(map((payload) => ({ type: 'sessions', data: payload })));
        return concat(of({ type: 'sessions', data: initial }), merge(updates, heartbeat()));
    }
};
SseService = __decorate([
    Injectable()
], SseService);
export { SseService };
function heartbeat() {
    return interval(30000).pipe(map(() => ({ type: 'ping', data: '' })));
}
//# sourceMappingURL=sse.service.js.map