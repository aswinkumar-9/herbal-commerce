import { isIP, isIPv4 } from 'node:net';

// The parts of an HTTP request that tell who connected.
interface Connection {
  ip?: string;
  socket?: { remoteAddress?: string };
}

// One phone or home usually gets a whole /64 block of IPv6 addresses, so
// limits count the block as one client, not each address in it.
function ipv6Block(ip: string): string {
  const address = ip.split('%')[0]; // drop a zone such as "%eth0"
  // Expand "::" so the first four groups are the real first 64 bits.
  const [head, tail] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array.from({ length: missing }, () => '0'),
    ...tailGroups,
  ];
  const first64 = groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16));
  return `${first64.join(':')}::/64`;
}

// The caller's exact address, or undefined if there is no valid one. Express's
// req.ip only uses X-Forwarded-For from proxies listed in TRUST_PROXY, so
// clients cannot fake it.
export function clientAddress(request: Connection): string | undefined {
  const ip = request.ip ?? request.socket?.remoteAddress;
  // IPv4 clients on an IPv6 socket appear as "::ffff:1.2.3.4".
  const mapped = ip && /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const address = mapped ? mapped[1] : ip;
  return address && isIP(address) ? address : undefined;
}

// The client that per-IP limits count against.
export function clientIpKey(request: Connection): string {
  const address = clientAddress(request);
  if (!address) {
    return 'unknown';
  }
  return isIPv4(address) ? address : ipv6Block(address);
}
