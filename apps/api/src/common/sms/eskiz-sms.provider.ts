import type { SmsProvider } from './sms.provider';

export interface EskizConfig {
  baseUrl: string;
  email: string;
  password: string;
  /** Sender name approved in the Eskiz account ("4546" until one is approved). */
  from: string;
}

type Fetch = typeof fetch;

/** A failed send; the message says what went wrong without the phone or the text. */
export class SmsSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsSendError';
  }
}

/**
 * Eskiz (notify.eskiz.uz), the Uzbek SMS gateway. Signs in with the account's email and
 * password for a token that lasts about a month, keeps it in memory and signs in again
 * when Eskiz says it has expired. Every text must match a template approved in the Eskiz
 * account, or Eskiz refuses it.
 */
export class EskizSmsProvider implements SmsProvider {
  private token: string | null = null;

  constructor(
    private readonly config: EskizConfig,
    private readonly http: Fetch = fetch,
  ) {}

  async send(to: string, text: string): Promise<void> {
    let response = await this.post(to, text, await this.currentToken());
    if (response.status === 401) {
      this.token = null;
      response = await this.post(to, text, await this.currentToken());
    }
    if (!response.ok) {
      throw new SmsSendError(`Eskiz refused the message: HTTP ${String(response.status)}`);
    }
  }

  private post(to: string, text: string, token: string): Promise<Response> {
    const form = new FormData();
    // Eskiz wants the number without the plus sign.
    form.set('mobile_phone', to.replace(/^\+/, ''));
    form.set('message', text);
    form.set('from', this.config.from);
    return this.http(`${this.config.baseUrl}/api/message/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  }

  private async currentToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }
    const form = new FormData();
    form.set('email', this.config.email);
    form.set('password', this.config.password);
    const response = await this.http(`${this.config.baseUrl}/api/auth/login`, {
      method: 'POST',
      body: form,
    });
    const body = (await response.json().catch(() => null)) as { data?: { token?: unknown } } | null;
    const token = body?.data?.token;
    if (!response.ok || typeof token !== 'string') {
      throw new SmsSendError(`Eskiz sign-in failed: HTTP ${String(response.status)}`);
    }
    this.token = token;
    return token;
  }
}
