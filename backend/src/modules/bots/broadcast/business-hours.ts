/**
 * Horários de atendimento (business hours) — interpretado no timezone do tenant.
 * Formato JSON persistido em `Tenant.businessHours`:
 *   {
 *     days: [
 *       { dayOfWeek: 0-6, open: "HH:mm", close: "HH:mm" }
 *     ],
 *     timezone?: string,  // override do timezone do tenant (raro)
 *   }
 * dayOfWeek: 0 = domingo ... 6 = sábado (js Date.getDay()).
 * `open`/`close` em horário LOCAL do timezone. Admite janelas que cruzam meia-noite
 * (ex: open=23:00 close=02:00) — ver `isOpenAt` com matching de intervalo.
 *
 * NULL/undefined → sem horários definidos = tratado como "sempre aberto"
 *                  (caller pode decidir OwnedBy caller; aqui nos dá isOpen=true).
 */
export interface BusinessHoursDay {
  dayOfWeek: number;
  open: string;
  close: string;
}

export interface BusinessHours {
  days: BusinessHoursDay[];
  timezone?: string;
}

/**
 * Determina se `now` está dentro de alguma janela de businessHours.
 * Usa Intl.DateTimeFormat para normalizar `now` para o timezone definido e
 * obter dia/hora/minuto coerentes.
 *
 * @param now Referência UTC atual.
 * @param businessHours Config do tenant (pode ser null = sempre aberto).
 * @param fallbackTimezone Timezone default do tenant (ex: Tenant.timezone).
 */
export function isOpenAt(
  now: Date,
  businessHours: BusinessHours | null | undefined,
  fallbackTimezone = 'America/Sao_Paulo',
): boolean {
  if (!businessHours || !businessHours.days || businessHours.days.length === 0) {
    return true; // Sem horário definido = sempre atende.
  }
  const tz = businessHours.timezone || fallbackTimezone;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayStr = get('weekday'); // 'Sun','Mon',...
  const hourStr = get('hour'); // '00'..'23' (pode ser '24' em alguns ambientes)
  const minuteStr = get('minute');

  const dayOfWeek = WEEKDAY_TO_NUM[weekdayStr] ?? 0;
  const hour = parseInt(hourStr === '24' ? '0' : hourStr, 10) || 0;
  const minute = parseInt(minuteStr, 10) || 0;
  const minutesOfDay = hour * 60 + minute;

  for (const d of businessHours.days) {
    if (d.dayOfWeek !== dayOfWeek) continue;
    const [oH, oM] = d.open.split(':').map((x) => parseInt(x, 10) || 0);
    const [cH, cM] = d.close.split(':').map((x) => parseInt(x, 10) || 0);
    const openMin = oH * 60 + oM;
    const closeMin = cH * 60 + cM;
    if (openMin <= closeMin) {
      if (minutesOfDay >= openMin && minutesOfDay < closeMin) return true;
    } else {
      // janela que cruza meia-noite
      if (minutesOfDay >= openMin || minutesOfDay < closeMin) return true;
    }
  }
  return false;
}

const WEEKDAY_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { days?: unknown; timezone?: unknown };
  if (!Array.isArray(obj.days)) return null;
  const days = obj.days
    .filter(
      (d): d is BusinessHoursDay =>
        !!d &&
        typeof (d as { dayOfWeek?: unknown }).dayOfWeek === 'number' &&
        typeof (d as { open?: unknown }).open === 'string' &&
        typeof (d as { close?: unknown }).close === 'string',
    )
    .map((d) => d);
  if (days.length === 0) return null;
  return {
    days,
    ...(typeof obj.timezone === 'string' ? { timezone: obj.timezone } : {}),
  };
}
