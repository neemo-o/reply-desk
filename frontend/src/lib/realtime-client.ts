import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "@/contexts/auth-store";

/// Cache do socket para evitar múltiplas conexões.
let socket: Socket | null = null;

function computeWsBaseUrl(): string {
  const api = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";
  const url = new URL(api);
  return `${url.protocol}//${url.host}`;
}

function getSocket(): Socket {
  if (!socket) {
    socket = io(computeWsBaseUrl(), {
      path: "/realtime",
      transports: ["websocket"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: (cb) => {
        const token = useAuthStore.getState().accessToken;
        cb({ token });
      },
    });
  }
  return socket;
}

export const realtimeClient = {
  socket: getSocket,
  connect: () => {
    const s = getSocket();
    if (!s.connected) s.connect();
  },
  disconnect: () => {
    const s = socket;
    if (s && s.connected) s.disconnect();
  },
  subscribeTenant: (tenantId: string) => {
    const s = getSocket();
    if (!s.connected) s.connect();
    s.emit("subscribe", { tenantId });
  },
};

export type { Socket };
