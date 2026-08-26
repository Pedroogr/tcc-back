import { io, Socket } from 'socket.io-client';

export function connectSocket(
  baseUrl: string,
  token?: string,
  timeoutMs = 1_000,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      auth: token ? { token } : undefined,
      extraHeaders: token ? { authorization: `Bearer ${token}` } : undefined,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      autoConnect: false,
    });

    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    };
    const onConnect = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(socket);
    };
    const onConnectError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.close();
      reject(error);
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.close();
      reject(new Error('Timed out connecting to socket'));
    }, timeoutMs);

    socket.once('connect', onConnect);
    socket.once('connect_error', onConnectError);
    socket.connect();
  });
}

export function waitForEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 1_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(event, listener);
    };
    const listener = (payload: T) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(payload);
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`Timed out waiting for socket event: ${event}`));
    }, timeoutMs);

    socket.once(event, listener);
  });
}

export function expectNoEvent(
  socket: Socket,
  event: string,
  timeoutMs = 250,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(event, listener);
    };
    const listener = (payload: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        new Error(
          `Unexpected socket event ${event}: ${JSON.stringify(payload)}`,
        ),
      );
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    }, timeoutMs);

    socket.once(event, listener);
  });
}
