export type ListenConfig = {
  port: number;
  host?: string;
};

export function readListenConfig(
  environment: NodeJS.ProcessEnv,
): ListenConfig {
  const rawPort = environment.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT precisa ser um inteiro entre 1 e 65535.');
  }

  const host = environment.HOST?.trim();
  return host ? { port, host } : { port };
}
