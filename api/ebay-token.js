// Cached token to avoid regenerating on every request
let cachedToken = null;
let tokenExpiry = 0;

export async function getEbayToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  
  // Fall back to EBAY_API_KEY if OAuth creds not set
  if (!clientId || !clientSecret) {
    return process.env.EBAY_API_KEY || null;
  }

  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    });

    if (!r.ok) return process.env.EBAY_API_KEY || null;
    const d = await r.json();
    cachedToken = d.access_token;
    tokenExpiry = Date.now() + (d.expires_in * 1000);
    return cachedToken;
  } catch {
    return process.env.EBAY_API_KEY || null;
  }
}
