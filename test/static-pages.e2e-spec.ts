import request from 'supertest';
import { E2eContext, createE2eApp } from './support/e2e-app';

describe('static streaming pages (e2e)', () => {
  let context: E2eContext;

  beforeAll(async () => {
    context = await createE2eApp();
  });

  afterAll(async () => {
    await context?.app.close();
  });

  it.each([
    ['/camera.html', '<button id="startCamera">'],
    ['/transmitter.html', '<button id="startBtn">'],
    ['/viewer.html', '<video id="remoteVideo"'],
  ])(
    'serves %s as HTML containing its required control',
    async (path, marker) => {
      const response = await request(context.httpServer).get(path);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain(marker);
    },
  );

  it('returns 404 for a missing static page', async () => {
    await request(context.httpServer).get('/missing-e2e-page.html').expect(404);
  });
});
