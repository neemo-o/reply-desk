import { BadRequestException } from '@nestjs/common';

export type StepMessageType = 'text' | 'list' | 'buttons' | 'media' | 'handoff';

export interface StepContent {
  type: StepMessageType;
}

export interface TextContent extends StepContent {
  type: 'text';
  text: string;
}

export interface ButtonsContent extends StepContent {
  type: 'buttons';
  /// Corpo principal (header bold) exibido acima dos botões. Na Evolution API
  /// v2.3.7 (SendButtonsDto) este campo é enviado como `title`.
  text: string;
  /// Rodapé opcional exibido abaixo dos botões (campo `footer` na Evolution).
  footer?: string;
  buttons: { id: string; title: string }[];
}

export interface ListContent extends StepContent {
  type: 'list';
  /// Título da lista (cabeçalho da lista — campo `title` na Evolution API).
  title: string;
  /// Texto da lista (corpo/rodapé da mensagem — enviado como `footerText` na
  /// Evolution API v2.3.7 / `SendListDto.footerText`). Em UI do WhatsApp é o
  /// subtítulo mostrado abaixo do título.
  text: string;
  buttonText: string;
  sections: {
    title: string;
    rows: { id: string; title: string; description?: string }[];
  }[];
}

export interface MediaContent extends StepContent {
  type: 'media';
  mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  url: string;
  caption?: string;
}

/**
 * Step HANDOFF — transfere a conversa para atendimento humano.
 * Não envia mensagem ao contato via Evolution. Em vez disso:
 *  - atualiza `Conversation.assignedUser` (se `actionConfig.assignUserId`)
 *  - marca `BotSession.status='routed'`
 *  - opcionalmente envia `message` (texto de despedida/explicação) ao contato.
 * `actionConfig` reservado p/ roteamento futuro (queue/departamento).
 */
export interface HandoffActionConfig {
  assignUserId?: string;
  queue?: string;
  department?: string;
}

export interface HandoffContent extends StepContent {
  type: 'handoff';
  /// Texto opcional enviado ao contato ANTES do handoff (ex: "Vou te transferir...").
  message?: string;
  /// Configuração de roteamento (quem/queue/departamento assume).
  actionConfig?: HandoffActionConfig;
}

export type ValidatedStepContent =
  | TextContent
  | ButtonsContent
  | ListContent
  | MediaContent
  | HandoffContent;

export function validateStepContent(
  tipoMensagem: string,
  conteudo: Record<string, unknown>,
): ValidatedStepContent {
  if (tipoMensagem === 'text') {
    if (typeof conteudo.text !== 'string' || conteudo.text.trim().length === 0) {
      throw new BadRequestException('conteudo.text é obrigatório para tipo text');
    }
    return { type: 'text', text: conteudo.text } as TextContent;
  }

  if (tipoMensagem === 'buttons') {
    // Retrocompat: steps legados podem ter buttons sem `text` — default vazio.
    const text =
      typeof conteudo.text === 'string' ? conteudo.text : '';
    if (text.trim().length === 0 && (!Array.isArray(conteudo.buttons) || conteudo.buttons.length === 0)) {
      throw new BadRequestException('conteudo.text é obrigatório para tipo buttons');
    }
    const buttons = conteudo.buttons;
    if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
      throw new BadRequestException('conteudo.buttons deve ter entre 1 e 3 itens');
    }
    for (const b of buttons) {
      if (typeof b?.id !== 'string' || typeof b?.title !== 'string') {
        throw new BadRequestException('buttons.*.id e title são obrigatórios');
      }
    }
    return {
      type: 'buttons',
      text,
      ...(typeof conteudo.footer === 'string' ? { footer: conteudo.footer } : {}),
      buttons: buttons as { id: string; title: string }[],
    } as ButtonsContent;
  }

  if (tipoMensagem === 'list') {
    if (typeof conteudo.title !== 'string' || conteudo.title.trim().length === 0) {
      throw new BadRequestException('conteudo.title é obrigatório para tipo list');
    }
    // Retrocompat: steps salvos antes deste fix podem não ter `text` (footerText)
    // — fallback para vazio em vez de falhar a validação.
    const text =
      typeof conteudo.text === 'string'
        ? conteudo.text
        : '';
    if (typeof conteudo.buttonText !== 'string' || conteudo.buttonText.trim().length === 0) {
      throw new BadRequestException('conteudo.buttonText é obrigatório para tipo list');
    }
    const sections = conteudo.sections;
    if (!Array.isArray(sections) || sections.length === 0 || sections.length > 1) {
      throw new BadRequestException('conteudo.sections deve ter exatamente 1 seção (limite WhatsApp)');
    }
    for (const s of sections) {
      if (typeof s?.title !== 'string' || !Array.isArray(s?.rows) || s.rows.length === 0) {
        throw new BadRequestException('sections.*.title e rows são obrigatórios');
      }
      if (s.rows.length > 10) {
        throw new BadRequestException('Máximo de 10 linhas por seção');
      }
      for (const r of s.rows) {
        if (typeof r?.id !== 'string' || typeof r?.title !== 'string') {
          throw new BadRequestException('rows.*.id e title são obrigatórios');
        }
      }
    }
    return {
      type: 'list',
      title: conteudo.title,
      text,
      buttonText: conteudo.buttonText,
      sections: sections as ListContent['sections'],
    } as ListContent;
  }

  if (tipoMensagem === 'media') {
    const mediaType = conteudo.mediaType;
    if (
      mediaType !== 'image' &&
      mediaType !== 'video' &&
      mediaType !== 'audio' &&
      mediaType !== 'document' &&
      mediaType !== 'sticker'
    ) {
      throw new BadRequestException('conteudo.mediaType inválido');
    }
    if (typeof conteudo.url !== 'string' || conteudo.url.trim().length === 0) {
      throw new BadRequestException('conteudo.url é obrigatório para tipo media');
    }
    return {
      type: 'media',
      mediaType,
      url: conteudo.url,
      ...(typeof conteudo.caption === 'string' ? { caption: conteudo.caption } : {}),
    } as MediaContent;
  }

  if (tipoMensagem === 'handoff') {
    const message =
      typeof conteudo.message === 'string' ? conteudo.message : undefined;
    const actionConfig = (conteudo.actionConfig ?? undefined) as
      | HandoffActionConfig
      | undefined;
    // Validação leve de actionConfig.
    if (actionConfig) {
      if (
        actionConfig.assignUserId !== undefined &&
        typeof actionConfig.assignUserId !== 'string'
      ) {
        throw new BadRequestException('actionConfig.assignUserId deve ser string');
      }
      if (
        actionConfig.queue !== undefined &&
        typeof actionConfig.queue !== 'string'
      ) {
        throw new BadRequestException('actionConfig.queue deve ser string');
      }
      if (
        actionConfig.department !== undefined &&
        typeof actionConfig.department !== 'string'
      ) {
        throw new BadRequestException('actionConfig.department deve ser string');
      }
    }
    return {
      type: 'handoff',
      ...(message ? { message } : {}),
      ...(actionConfig ? { actionConfig } : {}),
    } as HandoffContent;
  }

  throw new BadRequestException(`tipoMensagem inválido: ${tipoMensagem}`);
}
