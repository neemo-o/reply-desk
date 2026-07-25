import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/contexts/auth-store";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

export const apiClient = axios.create({
  baseURL: API_URL,
});

apiClient.interceptors.request.use((config) => {
  const { accessToken, tenantId } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  if (tenantId) {
    config.headers["x-tenant-id"] = tenantId;
  }
  return config;
});

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let refreshPromise: Promise<string | null> | null = null;

// 🔒 S4 — Sincronização de sessão entre abas via BroadcastChannel.
// Quando uma aba faz refresh com sucesso, ela transmite os novos tokens e
// as outras abas atualizam seus tokens em memória — sem precisar chamar
// /auth/refresh de novo (o que revogaria o token recém-gerado).
//
// Sem isso, cada aba faria seu próprio refresh com o token antigo (agora
// rotacionado), receberia 401 e cairia em clearSession() → logout
// fantasma em multi-aba. Aqui usamos o BroadcastChannel em vez do evento
// `storage` porque o zustand persist usa localStorage E porque queremos
// que o evento seja capturado até pela própria aba que disparou (storage
// event não dispara na aba originária).
const SESSION_CHANNEL: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("replydesk-session") : null;

if (SESSION_CHANNEL) {
  SESSION_CHANNEL.onmessage = (event) => {
    if (!event.data) return;
    const { type, accessToken, refreshToken, accessTokenExp } = event.data as {
      type: "refreshed" | "logout";
      accessToken?: string;
      refreshToken?: string;
      accessTokenExp?: number;
    };
    const store = useAuthStore.getState();
    if (type === "refreshed" && accessToken && refreshToken) {
      store.setSession({ accessToken, refreshToken, accessTokenExp });
    } else if (type === "logout") {
      store.clearSession();
    }
  };
}

function broadcastSessionUpdate(payload: {
  type: "refreshed" | "logout";
  accessToken?: string;
  refreshToken?: string;
  accessTokenExp?: number;
}) {
  SESSION_CHANNEL?.postMessage(payload);
}

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, setSession, clearSession } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    const { data } = await axios.post<{
      accessToken: string;
      refreshToken: string;
      accessTokenExp?: number;
    }>(`${API_URL}/auth/refresh`, { refreshToken });
    setSession({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExp: data.accessTokenExp,
    });
    // Avisa outras abas que atualizamos os tokens.
    broadcastSessionUpdate({
      type: "refreshed",
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExp: data.accessTokenExp,
    });
    return data.accessToken;
  } catch {
    clearSession();
    broadcastSessionUpdate({ type: "logout" });
    return null;
  }
}

// 🔁 Em caso de 401, tenta renovar a sessão via refresh token uma única vez
// (evitando corridas concorrentes) antes de repetir a requisição original.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableConfig | undefined;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/auth/")
    ) {
      originalRequest._retry = true;

      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null;
      });

      const newAccessToken = await refreshPromise;

      if (newAccessToken) {
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      }
    }

    return Promise.reject(error);
  },
);
