/* global __ENV, __VU, open */
// Load test (docs/TZ.md section 4 and acceptance criterion 14): 100 concurrent users on
// the demo organization for a few minutes. Most of them work in the staff panel (lists,
// journal, daily report), the rest scan member QR codes at the reception desk.
// Thresholds are the TZ targets: API p95 < 300 ms, QR check p95 < 500 ms, < 1 % errors.
// How to run: infra/load/README.md.
import { check, sleep } from 'k6';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:8000';
// The organization's address; behind a proxy the API reads it from X-Forwarded-Host.
const TENANT_HOST = __ENV.TENANT_HOST || 'demo.localhost:3000';
const codes = JSON.parse(open('./.tokens.json'));

export const options = {
  scenarios: {
    users: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 100 },
        { duration: __ENV.HOLD || '2m', target: 100 },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{kind:api}': ['p(95)<300'],
    'http_req_duration{kind:qr}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

// Each virtual user is a different desk: its own address, so the per-IP rate limit sees
// 100 users, not one (the API trusts X-Forwarded-For behind its proxy).
const headers = (cookie) => ({
  'Content-Type': 'application/json',
  'X-Gatefit-Client': 'staff',
  'X-Forwarded-Host': TENANT_HOST,
  'X-Forwarded-For': `10.77.${Math.floor(__VU / 250)}.${__VU % 250}`,
  ...(cookie ? { Cookie: cookie } : {}),
});

/** Signs in once; every virtual user shares the session (staff without TOTP). */
export function setup() {
  const response = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ phone: __ENV.STAFF_PHONE, password: __ENV.STAFF_PASSWORD }),
    { headers: headers(), tags: { kind: 'setup' } },
  );
  if (response.status !== 204) {
    throw new Error(`Sign-in failed: HTTP ${response.status}. Set STAFF_PHONE and STAFF_PASSWORD.`);
  }
  const cookie = Object.entries(response.cookies)
    .map(([name, values]) => `${name}=${values[0].value}`)
    .join('; ');
  const locations = JSON.parse(
    http.get(`${BASE_URL}/api/v1/locations`, { headers: headers(cookie), tags: { kind: 'setup' } })
      .body,
  );
  return { cookie, locationId: locations[0].id };
}

/** The code of a member valid right now. */
function currentCode() {
  const member = codes.members[Math.floor(Math.random() * codes.members.length)];
  const step = Math.floor((Date.now() / 1000 - codes.firstStep) / codes.stepSeconds);
  return {
    token: member.codes[Math.min(Math.max(step, 0), member.codes.length - 1)],
    locationId: member.locationId,
  };
}

export default function (data) {
  const h = headers(data.cookie);
  if (Math.random() < 0.3) {
    const { token, locationId } = currentCode();
    const response = http.post(
      `${BASE_URL}/api/v1/access/verify`,
      JSON.stringify({ token, locationId }),
      {
        headers: h,
        tags: { kind: 'qr', name: 'POST /access/verify' },
      },
    );
    check(response, {
      'qr answered': (r) => r.status === 200,
      'qr decided': (r) => r.status === 200 && JSON.parse(r.body).member !== null,
    });
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const pages = [
      ['GET /members', `/api/v1/members?limit=20`],
      ['GET /members?q', `/api/v1/members?limit=20&q=Kar`],
      ['GET /check-ins', `/api/v1/check-ins?locationId=${data.locationId}&limit=50`],
      ['GET /payments', `/api/v1/payments?locationId=${data.locationId}&limit=50`],
      ['GET /reports/daily', `/api/v1/reports/daily?locationId=${data.locationId}&date=${today}`],
      ['GET /plans', `/api/v1/plans?limit=100`],
      ['GET /me', `/api/v1/me`],
    ];
    const [name, path] = pages[Math.floor(Math.random() * pages.length)];
    const response = http.get(`${BASE_URL}${path}`, { headers: h, tags: { kind: 'api', name } });
    check(response, { 'page answered': (r) => r.status === 200 });
  }
  sleep(1 + Math.random());
}
