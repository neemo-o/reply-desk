import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuthStore } from "./auth-store";
import { authService } from "@/services/auth-service";
import type { LoginPayload, MeTenant, RegisterPayload, TenantRole, User } from "@/types/auth";

interface AuthContextValue {
  user: User | null;
  /** Tenant ativo do usuário (hoje só existe um por usuário). */
  tenant: MeTenant | null;
  /** Papel do usuário no tenant ativo — usado para liberar telas de owner. */
  role: TenantRole | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  /** Reconsulta /auth/me e atualiza user + tenant no contexto e na store. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { accessToken, refreshToken, setSession, setUser, setTenantId, setSessionExpiry, clearSession } = useAuthStore();
  const [user, setLocalUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<MeTenant | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  function applySnapshot(snapshot: Awaited<ReturnType<typeof authService.meSnapshot>>) {
    const nextUser: User = {
      id: snapshot.user.id,
      name: snapshot.user.name,
      email: snapshot.user.email,
      emailVerified: snapshot.user.emailVerified,
    };
    // Regra de negócio atual do backend: no máximo 1 tenant por usuário.
    const activeTenant = snapshot.tenants[0] ?? null;

    setLocalUser(nextUser);
    setUser(nextUser);
    setTenant(activeTenant);
    setTenantId(activeTenant?.id ?? null);
    // 🔒 S4 — Atualiza a previsão de expiração da sessão (refresh token) no
    // store persistido, para o hook useSessionExpiry exibir "expira em X".
    setSessionExpiry(snapshot.session?.refreshExpiresAt ?? null);
  }

  useEffect(() => {
    async function bootstrap() {
      if (!accessToken) {
        setIsInitializing(false);
        return;
      }
      try {
        const snapshot = await authService.meSnapshot();
        applySnapshot(snapshot);
      } catch {
        clearSession();
      } finally {
        setIsInitializing(false);
      }
    }
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(payload: LoginPayload) {
    const tokens = await authService.login(payload);
    setSession(tokens);
    const snapshot = await authService.meSnapshot();
    applySnapshot(snapshot);
  }

  async function register(payload: RegisterPayload) {
    const tokens = await authService.register(payload);
    setSession(tokens);
    const snapshot = await authService.meSnapshot();
    applySnapshot(snapshot);
  }

  async function logout() {
    try {
      if (refreshToken) {
        await authService.logout(refreshToken);
      }
    } catch {
      // mesmo se a chamada falhar, limpamos a sessão local
    } finally {
      clearSession();
      setLocalUser(null);
      setTenant(null);
      toast.success("Sessão encerrada");
    }
  }

  // Usado após verificar e-mail, concluir pagamento, editar perfil etc. — para
  // atualizar user/tenant/assinatura no contexto sem precisar de novo login.
  async function refreshUser() {
    const snapshot = await authService.meSnapshot();
    applySnapshot(snapshot);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        role: tenant?.role ?? null,
        isAuthenticated: Boolean(accessToken && user),
        isInitializing,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  }
  return ctx;
}
