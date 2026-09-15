import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';
    socket = io(url, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
};

export const connectSocket = (): Socket => {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
};

export const disconnectSocket = (): void => {
  if (socket && socket.connected) {
    socket.disconnect();
  }
};
