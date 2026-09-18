import { io, Socket } from 'socket.io-client';
import { getStoredToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    // Connect to same host and port (port 3000)
    socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('Connected to ONTime realtime server:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from realtime server:', reason);
    });
  }
  return socket;
}

export function joinCompanyRoom(companyId: string): void {
  const s = getSocket();
  const token = getStoredToken();
  s.emit('join:company', { companyId, token: token || undefined });
}

export function joinTripRoom(trackingTokenOrId: string): void {
  const s = getSocket();
  const token = getStoredToken();
  s.emit('join:trip', {
    trackingToken: trackingTokenOrId,
    tripId: trackingTokenOrId,
    token: token || undefined,
  });
}

export function joinOrderRoom(orderId: string): void {
  joinTripRoom(orderId);
}

export function joinDriverRoom(driverId: string): void {
  const s = getSocket();
  const token = getStoredToken();
  s.emit('join:driver', { driverId, token: token || undefined });
}
