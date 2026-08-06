import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "@/contexts/auth-store";

/// Cache do socket para evitar múltiplas conexões.
let socket: Socket | null = null;

function computeWsBaseUrl(): string {
  // 🔒 Deriva a URL absoluta do backend/ws-server a partir de VITE_API_URL.
  // Aceita:
  //   - URL absoluta (ex.: http://localhost:3000/api/v1)
  //   - path relativo (ex.: /api/v1) — típico de produção servida pelo
  //     mesmo reverse proxy do backend; usa window.location.origin como base.
  //   - undefined/vazio: cai no fallback de dev (http://localhost:3000).
  // Antes este código crashava se VITE_API_URL fosse vazio/relativo
  // inválido ("Failed to construct 'URL'"), derrubando a página inteira
  // ao montar qualquer hook de realtime.
  const raw = import.meta.env.VITE_API_URL;
  const fallback = "http://localhost:3000/api/v1";
  const api =
    typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;

  let url: URL;
  try {
    // `new URL(api, base)` resolve relativo contra `base`. Se `api` for
    // absoluto, o `base` é ignorado; se for relativo, usa o origin atual
    // (correto para produção dentro do mesmo domínio do backend).
    url = new URL(api, window.location.origin);
  } catch {
    // Último recurso — base seguro.
    try {
      url = new URL(fallback);
    } catch {
      // Impossível (fallback é hardcoded válido), mas TS não sabe.
      url = new URL("http://localhost:3000");
    }
  }
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
