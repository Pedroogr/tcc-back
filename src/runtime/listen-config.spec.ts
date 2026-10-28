import { readListenConfig } from './listen-config';

describe('readListenConfig', () => {
  it('uses port 3000 without forcing a host by default', () => {
    expect(readListenConfig({})).toEqual({ port: 3000 });
  });

  it('reads an explicit loopback host and port', () => {
    expect(
      readListenConfig({ PORT: '3100', HOST: '127.0.0.1' }),
    ).toEqual({ port: 3100, host: '127.0.0.1' });
  });

  it.each(['invalid', '0', '65536', '3000.5'])(
    'rejects invalid PORT %s',
    (port) => {
      expect(() => readListenConfig({ PORT: port })).toThrow('PORT');
    },
  );

  it('ignores a blank HOST', () => {
    expect(readListenConfig({ HOST: '   ' })).toEqual({ port: 3000 });
  });
});
