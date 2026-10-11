interface Env {
  BACKEND_ORIGIN: string;
  ALLOWED_ORIGINS?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
}

function allowedOrigins(env: Env): Set<string> {
  return new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean));
}

function securityHeaders(origin: string | null, env: Env): Headers {
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Request-ID',
    'Access-Control-Max-Age': '600',
  });
  if (origin && allowedOrigins(env).has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowList = allowedOrigins(env);
    const headers = securityHeaders(origin, env);

    if (origin && !allowList.has(origin) && request.method === 'OPTIONS') {
      return Response.json({ error: 'Origin not allowed' }, { status: 403, headers });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (origin && allowList.size > 0 && !allowList.has(origin) && origin !== url.origin) {
      return Response.json({ error: 'Origin not allowed' }, { status: 403, headers });
    }
    if (url.pathname === '/edge-health') {
      return Response.json({ status: 'ok', service: 'hendy-studio-edge', time: new Date().toISOString() }, { headers });
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      const supplied = request.headers.get('x-telegram-bot-api-secret-token');
      if (!env.TELEGRAM_WEBHOOK_SECRET || supplied !== env.TELEGRAM_WEBHOOK_SECRET) {
        return Response.json({ error: 'Unauthorized webhook' }, { status: 401, headers });
      }
      if (!env.TELEGRAM_BOT_TOKEN) return Response.json({ error: 'Bot integration is not configured' }, { status: 503, headers });
      const update = await request.json().catch(() => null) as { message?: { chat?: { id?: number }; text?: string } } | null;
      const message = update?.message;
      if (message?.chat?.id && typeof message.text === 'string') {
        const text = message.text.startsWith('/start')
          ? 'Xin chào! Mở Hendy Studio để quản lý dự án video của bạn.'
          : 'Đã nhận lệnh. Các thao tác dựng video được thực hiện trong Hendy Studio.';
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: message.chat.id, text }),
        });
        if (!response.ok) return Response.json({ error: 'Telegram API request failed' }, { status: 502, headers });
      }
      return Response.json({ ok: true }, { headers });
    }

    let backend: URL;
    try { backend = new URL(url.pathname + url.search, env.BACKEND_ORIGIN); }
    catch { return Response.json({ error: 'Backend origin is invalid' }, { status: 500, headers }); }
    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.delete('host');
    forwardedHeaders.delete('cf-connecting-ip');
    const upstreamRequest = new Request(backend.toString(), new Request(request, { headers: forwardedHeaders }));
    const upstream = await fetch(upstreamRequest);
    const outputHeaders = new Headers(upstream.headers);
    for (const [name, value] of headers.entries()) outputHeaders.set(name, value);
    outputHeaders.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outputHeaders });
  },
} satisfies ExportedHandler<Env>;
