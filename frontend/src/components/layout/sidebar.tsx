import { useMemo, useState } from "react";
import {
  Check,
  ChevronUp,
  Clock,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Palette,
  User as UserIcon,
  X,
  Menu,
  LayoutDashboard,
  Settings,
  Users,
  Smartphone,
  Bot,
  Contact,
} from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/layout/logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/auth-provider";
import { useTheme } from "@/contexts/theme-provider";
import { useProfile } from "@/hooks/use-profile";
import { useSessionExpiry } from "@/hooks/use-session-expiry";
import { useWhatsappSessions } from "@/hooks/use-whatsapp";
import { useInstanceStatus } from "@/hooks/use-instance-status";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard, end: true },
] as const;

const ATTENDANCE_ITEMS = [
  { to: "/dashboard/whatsapp", label: "Sessões", icon: Smartphone, end: false },
] as const;

const AUTOMATION_ITEMS = [
  { to: "/dashboard/bots", label: "Bots", icon: Bot, end: false },
  { to: "/dashboard/contact-lists", label: "Contatos", icon: Contact, end: false },
] as const;

const MANAGEMENT_ITEMS = [
  { to: "/dashboard/members", label: "Membros", icon: Users, end: false },
] as const;

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { data: profile } = useProfile();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const session = useSessionExpiry();

  const themeOptions = [
    { value: "light" as const, label: "Tema claro", icon: Sun },
    { value: "dark" as const, label: "Tema escuro", icon: Moon },
    { value: "system" as const, label: "Padrão do dispositivo", icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Abrir menu do usuário"
        >
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={profile?.avatar ?? undefined} alt={user?.name} />
            <AvatarFallback>
              {user ? initials(user.name) : <UserIcon className="h-4 w-4" />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} className="w-[15.5rem]">
        {/* 🔒 S4 — Sessão atual: countdown do access token + previsão de refresh. */}
        {session.hasSession && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground" aria-label="Tempo restante da sessão">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="tabular-nums">
                {session.isAccessExpired ? "Token expirado" : `Token em ${session.accessFormatted}`}
              </span>
            </div>
            <p className="ml-5 mt-0.5 text-[11px] opacity-80">
              Sessão expira em {session.refreshFormatted}
            </p>
          </div>
        )}

        <DropdownMenuItem
          onClick={() => {
            onNavigate?.();
            navigate("/dashboard/profile");
          }}
        >
          <Settings className="h-4 w-4" />
          Configurações
        </DropdownMenuItem>

        {/* Submenu de tema — abre ao passar o mouse */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="h-4 w-4" />
            Aparência
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[13rem]">
            {themeOptions.map((opt) => {
              const Icon = opt.icon;
              const isActive = theme === opt.value;
              return (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className="gap-2.5"
                >
                  <Icon className="h-4 w-4" />
                  {opt.label}
                  {isActive && <Check className="ml-auto h-4 w-4 text-brand-500" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => void logout()}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SidebarContentProps {
  onNavigate?: () => void;
}

function SidebarContent({ onNavigate }: SidebarContentProps) {
  const { role } = useAuth();
  const showManagement = role === "owner" || role === "admin";

  // 📱 Badge no sidebar: contagem por status das sessões do tenant.
  // - `qr_expired` → status terminal (vermelho — ação obrigatória).
  // - `connecting` → em andamento (amarelo).
  // - `connected` → ativa e usável (verde).
  // Badges podem coexistir; cada status aparece com sua cor. Só
  // owner/admin veem os badges (agentes não gerenciam sessões).
  const { data: sessions } = useWhatsappSessions();
  const errorCount = useMemo(() => {
    if (!showManagement || !sessions) return 0;
    return sessions.filter((s) => s.status === "qr_expired").length;
  }, [showManagement, sessions]);
  const connectingCount = useMemo(() => {
    if (!showManagement || !sessions) return 0;
    return sessions.filter((s) => s.status === "connecting").length;
  }, [showManagement, sessions]);
  const connectedCount = useMemo(() => {
    if (!showManagement || !sessions) return 0;
    return sessions.filter((s) => s.status === "connected").length;
  }, [showManagement, sessions]);

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center px-6 shrink-0">
        <Link to="/dashboard" onClick={onNavigate}>
          <Logo className="h-7" />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )
              }
            >
              <Icon className="h-4.5 w-4.5 shrink-0" />
              {item.label}
            </NavLink>
          );
        })}

        <p className="px-3 pt-6 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          Atendimento
        </p>
        {ATTENDANCE_ITEMS.map((item) => {
          const Icon = item.icon;
          // 📱 Badges: só para a rota de Sessões. Cada status tem sua cor
          // e só aparece quando há contagem > 0. Prioridade visual: vermelho
          // (erro) > amarelo (conectando) > verde (conectadas).
          const isSessionsRoute = item.to === "/dashboard/whatsapp";
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )
              }
            >
              <Icon className="h-4.5 w-4.5 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {isSessionsRoute && errorCount > 0 && (
                <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1.5 tabular-nums" title={`${errorCount} sessão(ões) com erro`}>
                  {errorCount}
                </Badge>
              )}
              {isSessionsRoute && connectingCount > 0 && (
                <Badge variant="warning" className="h-5 min-w-5 justify-center px-1.5 tabular-nums" title={`${connectingCount} sessão(ões) conectando`}>
                  {connectingCount}
                </Badge>
              )}
              {isSessionsRoute && connectedCount > 0 && (
                <Badge variant="success" className="h-5 min-w-5 justify-center px-1.5 tabular-nums" title={`${connectedCount} sessão(ões) conectada(s)`}>
                  {connectedCount}
                </Badge>
              )}
            </NavLink>
          );
        })}

        {/* ---- Automação ---- */}
        <div className="flex items-center gap-2 px-3 pt-6 pb-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex-1">
            Automação
          </p>
          <InstanceStatusDot />
        </div>
        {AUTOMATION_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )
              }
            >
              <Icon className="h-4.5 w-4.5 shrink-0" />
              {item.label}
            </NavLink>
          );
        })}

        {showManagement && (
          <>
            <p className="px-3 pt-6 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              Gestão
            </p>
            {MANAGEMENT_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  {item.label}
                </NavLink>
              );
            })}
          </>
        )}
      </nav>

      {/* Footer: user dropdown (opens upward) */}
      <div className="shrink-0 border-t border-border p-3">
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  function handleNavigate() {
    setMobileOpen(false);
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md lg:hidden">
        <Logo className="h-7" />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir menu"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Desktop sidebar (fixed) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-card lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink-950/50 backdrop-blur-sm lg:hidden"
          aria-hidden
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card transition-transform duration-300 ease-in-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        key={location.pathname}
      >
        <button
          className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Fechar menu"
          onClick={() => setMobileOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
        <SidebarContent onNavigate={handleNavigate} />
      </aside>
    </>
  );
}

function InstanceStatusDot() {
  const { data } = useInstanceStatus();
  const status = data?.status ?? "unknown";
  const color =
    status === "connected"
      ? "bg-emerald-500"
      : status === "disconnected"
      ? "bg-red-500"
      : status === "partial"
      ? "bg-amber-500"
      : "bg-muted-foreground/60";
  return (
    <span
      title={`Instância: ${status}`}
      className={`inline-block h-2 w-2 rounded-full ${color}`}
      aria-hidden
    />
  );
}
