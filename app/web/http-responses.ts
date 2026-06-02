export const jsonResponse = (data: unknown, status = 200): Response => {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};

export const errorResponse = (message: string, status = 400): Response => {
  return jsonResponse({ ok: false, error: message }, status);
};

export const successResponse = (data: Record<string, unknown>): Response => {
  return jsonResponse({ ok: true, ...data });
};

export const corsHeaders = (res: Response): Response => {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set(
    "Access-Control-Allow-Methods",
    "GET, PUT, POST, DELETE, OPTIONS",
  );
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
};
