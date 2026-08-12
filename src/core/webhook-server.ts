import { Webhooks } from '@octokit/webhooks';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorMessage } from '../shared/errors';
import type { HandledWebhookDelivery, HandledWebhookEventName } from '../shared/types';
import { childLogger } from './logger';

const log = childLogger('webhook');

/** Events we know how to turn into notifications. Anything else gets a 202. */
const HANDLED_EVENTS: ReadonlySet<string> = new Set<HandledWebhookEventName>([
  'ping',
  'push',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'check_suite',
  'check_run',
]);

export interface WebhookServerOptions {
  port: number;
  /** Shared secret configured on the GitHub side. Required. */
  secret: string;
  host?: string;
  onDelivery: (delivery: HandledWebhookDelivery, deliveryId: string) => Promise<void>;
}

interface WebhookHeaders {
  'x-github-event'?: string;
  'x-github-delivery'?: string;
  'x-hub-signature-256'?: string;
}

/**
 * HTTP receiver for GitHub webhooks.
 *
 * Note this only ever receives anything if GitHub can reach the port. On a
 * laptop that means a tunnel (cloudflared, ngrok) or a port forward in front of
 * it. Without one, the poller is the only working source and this server just
 * sits idle, which is a valid configuration.
 */
export class WebhookServer {
  private server: FastifyInstance | null = null;
  private webhooks: Webhooks | null = null;
  private options: WebhookServerOptions | null = null;
  private lastDeliveryAt: Date | null = null;

  get isListening(): boolean {
    return this.server !== null;
  }

  get lastDelivery(): Date | null {
    return this.lastDeliveryAt;
  }

  async start(options: WebhookServerOptions): Promise<void> {
    await this.stop();
    this.options = options;
    this.webhooks = new Webhooks({ secret: options.secret });

    const server = Fastify({
      logger: false,
      bodyLimit: 5 * 1024 * 1024,
      trustProxy: true,
    });

    // Signature verification needs the exact bytes GitHub signed, so the JSON
    // body is kept as a raw string and parsed only after the check passes.
    server.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        done(null, body);
      }
    );

    server.get('/health', async () => ({
      ok: true,
      service: 'github-notifier-webhook',
      lastDeliveryAt: this.lastDeliveryAt?.toISOString() ?? null,
    }));

    server.post('/webhook', async (request, reply) => {
      const headers = request.headers as WebhookHeaders;
      const eventName = headers['x-github-event'];
      const deliveryId = headers['x-github-delivery'] ?? 'unknown';
      const signature = headers['x-hub-signature-256'];
      const rawBody = typeof request.body === 'string' ? request.body : '';

      if (!eventName || !signature) {
        return reply.code(400).send({ error: 'Missing GitHub webhook headers' });
      }

      const verified = await this.verify(rawBody, signature);
      if (!verified) {
        log.warn({ deliveryId, ip: request.ip }, 'rejected webhook with bad signature');
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      if (!HANDLED_EVENTS.has(eventName)) {
        return reply.code(202).send({ ok: true, ignored: eventName });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return reply.code(400).send({ error: 'Body is not valid JSON' });
      }

      this.lastDeliveryAt = new Date();

      // Reply before processing: GitHub times deliveries out at 10s and will
      // mark the hook unhealthy if Mongo happens to be slow.
      void reply.code(202).send({ ok: true });

      try {
        const delivery = { name: eventName, payload } as HandledWebhookDelivery;
        await options.onDelivery(delivery, deliveryId);
      } catch (error) {
        log.error({ deliveryId, event: eventName, err: errorMessage(error) }, 'delivery failed');
      }
      return reply;
    });

    await server.listen({ port: options.port, host: options.host ?? '0.0.0.0' });
    this.server = server;
    log.info({ port: options.port }, 'webhook server listening');
  }

  private async verify(rawBody: string, signature: string): Promise<boolean> {
    if (!this.webhooks) {
      return false;
    }
    try {
      return await this.webhooks.verify(rawBody, signature);
    } catch (error) {
      log.error({ err: errorMessage(error) }, 'signature verification threw');
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      log.info('webhook server stopped');
    }
    this.server = null;
    this.webhooks = null;
  }

  get port(): number {
    return this.options?.port ?? 0;
  }
}

export const webhookServer = new WebhookServer();
