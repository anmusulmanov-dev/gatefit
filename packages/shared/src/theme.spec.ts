import { DEFAULT_THEME, fetchBranding, parseColorMode, THEME_COLORS, THEMES } from './theme';

describe('parseColorMode', () => {
  it('keeps a known mode and falls back to the system one', () => {
    expect(parseColorMode('dark')).toBe('dark');
    expect(parseColorMode('light')).toBe('light');
    expect(parseColorMode('purple')).toBe('system');
    expect(parseColorMode(undefined)).toBe('system');
  });
});

describe('themes', () => {
  it('has a colour for every theme and a default among them', () => {
    expect(Object.keys(THEME_COLORS).sort()).toEqual([...THEMES].sort());
    expect(THEMES).toContain(DEFAULT_THEME);
  });
});

describe('fetchBranding', () => {
  const request = { apiUrl: 'http://api', audience: 'staff' as const, host: 'demo.localhost' };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function answer(status: number, body: unknown) {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  it('returns the name and theme and forwards the host', async () => {
    answer(200, { name: 'Fit Club', theme: 'olov', logoUrl: '/api/v1/files/x' });
    await expect(fetchBranding(request)).resolves.toEqual({
      name: 'Fit Club',
      theme: 'olov',
      logoUrl: '/api/v1/files/x',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://api/api/v1/branding',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-forwarded-host': 'demo.localhost' }) as unknown,
      }),
    );
  });

  it('is null for an unknown organization, an unknown theme or an unreachable API', async () => {
    answer(404, { code: 'ORGANIZATION_NOT_FOUND' });
    await expect(fetchBranding(request)).resolves.toBeNull();
    answer(200, { name: 'Fit Club', theme: 'pink' });
    await expect(fetchBranding(request)).resolves.toBeNull();
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('down'));
    await expect(fetchBranding(request)).resolves.toBeNull();
  });
});
