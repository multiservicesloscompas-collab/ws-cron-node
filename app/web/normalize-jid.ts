/**
 * Normalize a phone number to WhatsApp JID format.
 * "584129833320" -> "584129833320@s.whatsapp.net"
 * "+58 412-9833320" -> "584129833320@s.whatsapp.net"
 */
export const normalizeJid = (input: string): string => {
  if (input.includes("@")) return input;

  const digits = input.replace(/\D/g, "");
  let normalized = digits;

  if (normalized.startsWith("0")) {
    normalized = "58" + normalized.substring(1);
  } else if (!normalized.startsWith("58")) {
    normalized = "58" + normalized;
  }

  return `${normalized}@s.whatsapp.net`;
};
