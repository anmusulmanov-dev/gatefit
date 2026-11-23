import { EskizSmsProvider, SmsSendError } from './eskiz-sms.provider';

const CONFIG = {
  baseUrl: 'https://notify.example',
  email: 'club@example.com',
  password: 'secret',
  from: '4546',
};

interface Call {
  url: string;
  auth: string | null;
  form: Record<string, string>;
}

/** A fake Eskiz: answers by path, records what was sent. */
function fakeEskiz(answers: { login?: number[]; send?: number[] } = {}) {
  const calls: Call[] = [];
  const login = [...(answers.login ?? [200])];
  const send = [...(answers.send ?? [200])];
  let issued = 0;
  const http = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const form = Object.fromEntries(
      [...(init?.body as FormData).entries()].map(([k, v]) => [
        k,
        typeof v === 'string' ? v : v.name,
      ]),
    );
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get('Authorization'), form });
    if (url.endsWith('/api/auth/login')) {
      const status = login.shift() ?? 200;
      issued += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ data: { token: `token-${String(issued)}` } }), { status }),
      );
    }
    return Promise.resolve(new Response('{}', { status: send.shift() ?? 200 }));
  };
  return { calls, http };
}

describe('EskizSmsProvider', () => {
  it('signs in once and sends with the token, the number without a plus', async () => {
    const eskiz = fakeEskiz({ send: [200, 200] });
    const provider = new EskizSmsProvider(CONFIG, eskiz.http);
    await provider.send('+998901234567', 'Hello');
    await provider.send('+998901234568', 'Again');
    expect(eskiz.calls.map((call) => call.url.replace(CONFIG.baseUrl, ''))).toEqual([
      '/api/auth/login',
      '/api/message/sms/send',
      '/api/message/sms/send',
    ]);
    expect(eskiz.calls[0]?.form).toEqual({ email: 'club@example.com', password: 'secret' });
    expect(eskiz.calls[1]).toMatchObject({
      auth: 'Bearer token-1',
      form: { mobile_phone: '998901234567', message: 'Hello', from: '4546' },
    });
  });

  it('signs in again when the token has expired', async () => {
    const eskiz = fakeEskiz({ send: [401, 200] });
    await new EskizSmsProvider(CONFIG, eskiz.http).send('+998901234567', 'Hello');
    expect(eskiz.calls.map((call) => call.auth)).toEqual([
      null,
      'Bearer token-1',
      null,
      'Bearer token-2',
    ]);
  });

  it('fails without the phone or the text in the error', async () => {
    const refused = new EskizSmsProvider(CONFIG, fakeEskiz({ send: [400] }).http);
    await expect(refused.send('+998901234567', 'Secret text')).rejects.toThrow(SmsSendError);
    await expect(
      new EskizSmsProvider(CONFIG, fakeEskiz({ send: [400] }).http).send(
        '+998901234567',
        'Secret text',
      ),
    ).rejects.toThrow(/^Eskiz refused the message: HTTP 400$/);
    const badLogin = new EskizSmsProvider(CONFIG, fakeEskiz({ login: [401] }).http);
    await expect(badLogin.send('+998901234567', 'x')).rejects.toThrow(
      'Eskiz sign-in failed: HTTP 401',
    );
  });
});
