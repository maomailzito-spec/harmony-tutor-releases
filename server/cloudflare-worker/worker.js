/**
 * Harmony Tutor — License Server (Cloudflare Worker)
 *
 * Proxies license operations to LemonSqueezy API.
 * Keeps the LEMONSQUEEZY_API_KEY secret on the server side.
 *
 * Endpoints:
 *   POST /activate   { licenseKey, instanceName }  → activate license
 *   POST /validate   { licenseKey, instanceId }    → check if still valid
 *   POST /deactivate { licenseKey, instanceId }    → free an activation slot
 *
 * Environment variables (set in Cloudflare dashboard):
 *   LEMONSQUEEZY_API_KEY  — your LemonSqueezy API key
 *   CORS_ORIGIN           — allowed origin (optional, default: *)
 */

const LEMON_API = 'https://api.lemonsqueezy.com/v1/licenses';

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      const body = await request.json();

      if (path === '/activate') {
        return await handleActivate(body, env);
      } else if (path === '/validate') {
        return await handleValidate(body, env);
      } else if (path === '/deactivate') {
        return await handleDeactivate(body, env);
      } else {
        return json({ error: 'Not found' }, 404, env);
      }
    } catch (err) {
      return json({ error: 'Invalid request' }, 400, env);
    }
  },
};

// ── Handlers ──

async function handleActivate({ licenseKey, instanceName }, env) {
  if (!licenseKey) return json({ error: 'Missing licenseKey' }, 400, env);

  const res = await fetch(`${LEMON_API}/activate`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      license_key: licenseKey,
      instance_name: instanceName || 'Harmony Tutor',
    }),
  });

  const data = await res.json();

  if (!res.ok || data.error) {
    return json({
      valid: false,
      error: data.error || data.message || 'Activation failed',
    }, res.status === 422 ? 422 : 400, env);
  }

  return json({
    valid: true,
    activated: true,
    instanceId: data.instance?.id || null,
    licenseKey: data.license_key?.key || licenseKey,
    customerName: data.license_key?.customer_name || data.meta?.customer_name || null,
    customerEmail: data.license_key?.customer_email || data.meta?.customer_email || null,
    expiresAt: data.license_key?.expires_at || null,
  }, 200, env);
}

async function handleValidate({ licenseKey, instanceId }, env) {
  if (!licenseKey) return json({ error: 'Missing licenseKey' }, 400, env);

  const body = { license_key: licenseKey };
  if (instanceId) body.instance_id = instanceId;

  const res = await fetch(`${LEMON_API}/validate`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  const data = await res.json();

  if (!res.ok) {
    return json({ valid: false, error: data.error || 'Validation failed' }, 400, env);
  }

  return json({
    valid: data.valid === true,
    licenseKey: data.license_key?.key || licenseKey,
    status: data.license_key?.status || 'unknown',
    expiresAt: data.license_key?.expires_at || null,
    activationLimit: data.license_key?.activation_limit || null,
    activationsUsed: data.license_key?.activations_used || 0,
  }, 200, env);
}

async function handleDeactivate({ licenseKey, instanceId }, env) {
  if (!licenseKey || !instanceId) {
    return json({ error: 'Missing licenseKey or instanceId' }, 400, env);
  }

  const res = await fetch(`${LEMON_API}/deactivate`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      license_key: licenseKey,
      instance_id: instanceId,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return json({ valid: false, error: data.error || 'Deactivation failed' }, 400, env);
  }

  return json({
    deactivated: data.deactivated === true,
  }, 200, env);
}

// ── Helpers ──

function lemonHeaders(env) {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.LEMONSQUEEZY_API_KEY}`,
  };
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  });
}
