/* global GOOGLE_CLIENT_ID */
// Read-only Google Contacts access via the People API.
// Uses Google's sign-in window (chrome.identity.launchWebAuthFlow), so it works without signing in to Chrome itself.
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
let googleToken = null; // { value, expiresAt }

function googleConfigured() {
  return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 0;
}

async function googleSignIn(interactive) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID.trim(),
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: GOOGLE_SCOPE,
    include_granted_scopes: 'true',
    ...(interactive ? {} : { prompt: 'none' }),
  });
  const redirect = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive });
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (params.get('error')) throw new Error(`Google sign-in failed: ${params.get('error')}`);
  const value = params.get('access_token');
  if (!value) throw new Error('Google sign-in did not return access.');
  googleToken = { value, expiresAt: Date.now() + (Number(params.get('expires_in')) || 3600) * 1000 - 60000 };
  return value;
}

async function googleAccessToken() {
  if (googleToken && googleToken.expiresAt > Date.now()) return googleToken.value;
  try {
    return await googleSignIn(false); // silent if already allowed before
  } catch {
    return googleSignIn(true);
  }
}

/** All saved Google contacts (names + phone numbers). Calls onProgress(countSoFar) per page. */
async function fetchGoogleContacts(onProgress) {
  let token = await googleAccessToken();
  const people = [];
  let pageToken = '';
  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections');
    url.search = new URLSearchParams({ personFields: 'names,phoneNumbers', pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { // token expired or revoked: sign in again once
      googleToken = null;
      token = await googleSignIn(true);
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Google Contacts error ${res.status}: ${body.error?.message || res.statusText}`);
    }
    const data = await res.json();
    people.push(...(data.connections || []));
    pageToken = data.nextPageToken || '';
    if (onProgress) onProgress(people.length);
  } while (pageToken);
  return people;
}
