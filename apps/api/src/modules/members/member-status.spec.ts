import { memberStatusFrom } from './member-status';

describe('memberStatusFrom', () => {
  it('is active while any membership is', () => {
    expect(memberStatusFrom('inactive', ['expired', 'active', 'frozen'])).toBe('active');
  });

  it('is frozen when the only memberships in force are frozen', () => {
    expect(memberStatusFrom('active', ['frozen', 'expired'])).toBe('frozen');
  });

  it('is expired once every membership has ended', () => {
    expect(memberStatusFrom('active', ['expired', 'cancelled'])).toBe('expired');
  });

  it('is inactive with nothing in force or ended', () => {
    expect(memberStatusFrom('active', [])).toBe('inactive');
    expect(memberStatusFrom('active', ['cancelled', 'scheduled'])).toBe('inactive');
  });

  it('keeps a block, even over a debt', () => {
    expect(memberStatusFrom('blocked', ['active'])).toBe('blocked');
    expect(memberStatusFrom('blocked', ['active'], true)).toBe('blocked');
  });

  it('is a debtor while money is overdue, whatever the memberships', () => {
    expect(memberStatusFrom('active', ['active'], true)).toBe('debtor');
    expect(memberStatusFrom('inactive', [], true)).toBe('debtor');
  });

  it('leaves debtor once the debt is settled', () => {
    expect(memberStatusFrom('debtor', ['active'], false)).toBe('active');
  });
});
