import { organizationSlugSchema } from './platform';

describe('organizationSlugSchema', () => {
  it.each(['demo', 'brother', 'fit-club-2', 'my-gym', 'a'.repeat(60)])('accepts %s', (slug) => {
    expect(organizationSlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    'admin',
    'my',
    'www',
    // Would collide with another organization's member app host.
    'demo-my',
    // No room left for the member app suffix.
    'a'.repeat(61),
    'Demo',
    '-demo',
  ])('rejects %s', (slug) => {
    expect(organizationSlugSchema.safeParse(slug).success).toBe(false);
  });
});
