import { expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { publicAddress } from '../../lib/server/evidence-check';
it('rejects private, loopback, link-local, shared, multicast and IPv6 addresses',()=>{
  for(const ip of ['0.1.2.3','10.1.2.3','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.168.0.1','100.64.0.1','100.127.255.255','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1'])expect(publicAddress(ip),ip).toBe(false);
  expect(publicAddress('8.8.8.8')).toBe(true);expect(publicAddress('1.1.1.1')).toBe(true);
});
