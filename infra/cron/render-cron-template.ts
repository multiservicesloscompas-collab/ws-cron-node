import { renderStreetWashersFailureBlock } from "../../domain/entities/render-street-washers-block.ts";

export interface BasicTemplateValues {
  date: string;
  day: string;
  time: string;
  streetWashersBlock?: string;
}

const getDayName = (date: string): string => {
  const days = [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
  ];

  return days[new Date(`${date}T12:00:00`).getDay()];
};

export const createBasicTemplateValues = (
  date: string,
  time: string,
  streetWashersBlock = renderStreetWashersFailureBlock(),
): BasicTemplateValues => ({
  date,
  day: getDayName(date),
  time,
  streetWashersBlock,
});

export const renderCronTemplate = (
  template: string,
  values: BasicTemplateValues,
): string => {
  return template
    .replace(/\{\{date\}\}/g, values.date)
    .replace(/\{\{day\}\}/g, values.day)
    .replace(/\{\{time\}\}/g, values.time)
    .replace(/\{\{street_washers\}\}/g, values.streetWashersBlock ?? "");
};

export const hasSalesTemplateVariables = (template: string): boolean => {
  return [
    "{{total_bs}}",
    "{{total_usd}}",
    "{{exchange_rate}}",
    "{{efectivo_bs}}",
    "{{pago_movil_bs}}",
    "{{punto_venta_bs}}",
    "{{divisa_bs}}",
    "{{payment_category_summary}}",
  ].some((token) => template.includes(token));
};
