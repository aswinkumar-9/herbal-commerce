import { clientIpKey } from './client-ip';

describe('clientIpKey', () => {
  it('uses an IPv4 address as it is', () => {
    expect(clientIpKey({ ip: '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('unwraps IPv4 addresses written as IPv6', () => {
    expect(clientIpKey({ ip: '::ffff:203.0.113.7' })).toBe('203.0.113.7');
  });

  it('counts a whole IPv6 /64 block as one client', () => {
    const block = '2001:db8:abcd:12::/64';
    expect(clientIpKey({ ip: '2001:db8:abcd:12:1:2:3:4' })).toBe(block);
    expect(clientIpKey({ ip: '2001:db8:abcd:12::99' })).toBe(block);
    expect(clientIpKey({ ip: '2001:0DB8:ABCD:0012::1' })).toBe(block);
    expect(clientIpKey({ ip: '2001:db8:abcd:13::1' })).not.toBe(block);
  });

  it('expands shortened IPv6 addresses before taking the block', () => {
    expect(clientIpKey({ ip: '2001:db8::1' })).toBe('2001:db8:0:0::/64');
    expect(clientIpKey({ ip: '::1' })).toBe('0:0:0:0::/64');
    expect(clientIpKey({ ip: 'fe80::1%eth0' })).toBe('fe80:0:0:0::/64');
  });

  it('falls back to the socket address, then to "unknown"', () => {
    expect(clientIpKey({ socket: { remoteAddress: '198.51.100.2' } })).toBe(
      '198.51.100.2',
    );
    expect(clientIpKey({})).toBe('unknown');
    expect(clientIpKey({ ip: 'not-an-ip' })).toBe('unknown');
  });
});
