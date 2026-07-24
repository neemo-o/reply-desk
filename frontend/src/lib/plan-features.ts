/**
 * Lista de benefícios exibidos nos cards de plano (seção visual).
 *
 * A estratégia comercial define um conjunto fixo de features por plano, em vez
 * de derivá-lo dinamicamente dos limites numéricos do backend. Itens marcados
 * com `included: false` renderizam com ícone de ✗ (indisponível) no plano Basic.
 *
 * O ``key`` baixo-normalizado é usado para casar com `plan.name` ("basic" /
 * "premium"); quando não há match, caímos no conjunto genérico derivado dos
 * limites do plano (comportamento anterior), preservando compatibilidade.
 */
export interface PlanFeature {
  label: string;
  included: boolean;
}

const FEATURES_BY_PLAN: Record<string, PlanFeature[]> = {
  basic: [
    { label: "1 Sessão do WhatsApp", included: true },
    { label: "Fluxos automáticos", included: true },
    { label: "Respostas pré-configuradas", included: true },
    { label: "IA personalizada", included: false },
    { label: "Base de conhecimento", included: false },
    { label: "Transferência para atendente", included: true },
    { label: "Até 3 usuários", included: true },
  ],
  premium: [
    { label: "Até 3 Sessões do WhatsApp", included: true },
    { label: "Fluxos automáticos", included: true },
    { label: "Respostas pré-configuradas", included: true },
    { label: "IA personalizada", included: true },
    { label: "Base de conhecimento", included: true },
    { label: "Transferência para atendente", included: true },
    { label: "Até 10 usuários", included: true },
    { label: "Relatórios avançados", included: true },
    { label: "Suporte prioritário", included: true },
  ],
};

/**
 * Retorna a lista de benefícios visuais de um plano.
 *
 * Caso o nome do plano não casse com Basic/Premium (ex: um plano futuro),
 * devolve `null` para que o chamador mantenha o fallback dinâmico original.
 */
export function getPlanFeatures(planName: string): PlanFeature[] | null {
  const key = planName.trim().toLowerCase();
  return FEATURES_BY_PLAN[key] ?? null;
}
