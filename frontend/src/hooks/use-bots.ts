import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { botsService } from "@/services/bots-service";
import { useAuth } from "@/contexts/auth-provider";
import { extractApiErrorMessage } from "@/lib/api-errors";
import type {
  CreateBotPayload,
  CreateBotStepPayload,
  CreateBotTriggerPayload,
  TestBotPayload,
  UpdateBotPayload,
  UpdateBotStepPayload,
  UpdateBotTriggerPayload,
} from "@/types/bots";

export function useBots() {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: ["bots", tenant?.id],
    queryFn: botsService.list,
    enabled: isAuthenticated && Boolean(tenant),
    staleTime: 30_000,
  });
}

export function useBot(id: string) {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: ["bots", tenant?.id, id],
    queryFn: () => botsService.getOne(id),
    enabled: isAuthenticated && Boolean(tenant) && Boolean(id),
  });
}

export function useCreateBot() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (payload: CreateBotPayload) => botsService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
      toast.success("Bot criado com sucesso");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível criar o bot."));
    },
  });
}

export function useUpdateBot() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & UpdateBotPayload) => botsService.update(id, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id, vars.id] });
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível atualizar o bot."));
    },
  });
}

export function useDeleteBot() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (id: string) => botsService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
      toast.success("Bot removido.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível remover o bot."));
    },
  });
}

export function useCreateTrigger() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: ({ botId, payload }: { botId: string; payload: CreateBotTriggerPayload }) =>
      botsService.createTrigger(botId, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id, vars.botId] });
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível adicionar o gatilho."));
    },
  });
}

export function useUpdateTrigger() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: ({
      botId,
      triggerId,
      payload,
    }: {
      botId: string;
      triggerId: string;
      payload: UpdateBotTriggerPayload;
    }) => botsService.updateTrigger(botId, triggerId, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id, vars.botId] });
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível atualizar o gatilho."));
    },
  });
}

export function useDeleteTrigger() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: ({ botId, triggerId }: { botId: string; triggerId: string }) =>
      botsService.removeTrigger(botId, triggerId),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id, vars.botId] });
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
      toast.success("Gatilho removido.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível remover o gatilho."));
    },
  });
}

export function useCreateStep() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: ({ botId, payload }: { botId: string; payload: CreateBotStepPayload }) =>
      botsService.createStep(botId, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id, vars.botId] });
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível adicionar o step."));
    },
  });
}

export function useUpdateStep() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: ({ botId, stepId, payload }: { botId: string; stepId: string; payload: UpdateBotStepPayload }) =>
      botsService.updateStep(botId, stepId, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id, vars.botId] });
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível atualizar o step."));
    },
  });
}

export function useDeleteStep() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: ({ botId, stepId }: { botId: string; stepId: string }) =>
      botsService.removeStep(botId, stepId),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id, vars.botId] });
      queryClient.invalidateQueries({ queryKey: ["bots", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível remover o step."));
    },
  });
}

export function useTestBot() {
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: TestBotPayload }) =>
      botsService.test(id, payload),
  });
}