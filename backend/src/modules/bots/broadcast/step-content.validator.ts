import { BadRequestException } from '@nestjs/common';

export type StepMessageType = 'text' | 'list' | 'buttons' | 'media';

export interface StepContent {
  type: StepMessageType;
}

export interface TextContent extends StepContent {
  type: 'text';
  text: string;
}

export interface ButtonsContent extends StepContent {
  type: 'buttons';
  text: string;
  buttons: { id: string; title: string }[];
}

export interface ListContent extends StepContent {
  type: 'list';
  title: string;
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

export type ValidatedStepContent =
  | TextContent
  | ButtonsContent
  | ListContent
  | MediaContent;

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
    if (typeof conteudo.text !== 'string') {
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
      text: conteudo.text,
      buttons: buttons as { id: string; title: string }[],
    } as ButtonsContent;
  }

  if (tipoMensagem === 'list') {
    if (typeof conteudo.title !== 'string') {
      throw new BadRequestException('conteudo.title é obrigatório para tipo list');
    }
    if (typeof conteudo.buttonText !== 'string') {
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
      for (const r of s.rows) {
        if (typeof r?.id !== 'string' || typeof r?.title !== 'string') {
          throw new BadRequestException('rows.*.id e title são obrigatórios');
        }
        if (r.rows.length > 10) {
          throw new BadRequestException('Máximo de 10 linhas por seção');
        }
      }
    }
    return {
      type: 'list',
      title: conteudo.title,
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

  throw new BadRequestException(`tipoMensagem inválido: ${tipoMensagem}`);
}
