const TZ = "America/Sao_Paulo";

export function saudacaoBrasilia(date = new Date()) {
  const hh = date.toLocaleString("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const h = parseInt(hh, 10);
  if (h >= 4 && h <= 11) return "Bom dia";
  if (h >= 12 && h <= 17) return "Boa tarde";
  return "Boa noite";
}
