import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/logo";
import { useAuth } from "@/contexts/auth-provider";

export function NotFoundPage() {
  const { isAuthenticated, user } = useAuth();
  const homePath = isAuthenticated && user?.emailVerified ? "/dashboard" : "/";

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <Logo className="h-8" />
      <p className="font-mono text-sm text-muted-foreground">Erro 404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        O endereço que você tentou acessar não existe ou foi movido.
      </p>
      <Button asChild>
        <Link to={homePath}>Voltar para o início</Link>
      </Button>
    </div>
  );
}
