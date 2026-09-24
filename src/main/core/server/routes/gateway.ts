import { FastifyReply, FastifyPluginAsync, FastifyRequest } from 'fastify';

import {
  checkJava,
  gatewayStatus,
  getGatewaySettings,
  restartGateway,
  saveGatewaySettings,
  startGateway,
  stopGateway,
} from '../../gateway';

const API_VERSION = 'api/v1';

const api: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get(`/${API_VERSION}/gateway/status`, async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.code(200).send(await gatewayStatus());
    } catch (err: any) {
      reply.code(500).send({ message: err?.message || String(err) });
    }
  });

  fastify.get(`/${API_VERSION}/gateway/settings`, async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.code(200).send(getGatewaySettings());
    } catch (err: any) {
      reply.code(500).send({ message: err?.message || String(err) });
    }
  });

  fastify.put(`/${API_VERSION}/gateway/settings`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const patch = (req.body || {}) as Record<string, any>;
      reply.code(200).send(saveGatewaySettings(patch));
    } catch (err: any) {
      reply.code(500).send({ message: err?.message || String(err) });
    }
  });

  fastify.post(`/${API_VERSION}/gateway/start`, async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.code(200).send(await startGateway());
    } catch (err: any) {
      reply.code(500).send({ message: err?.message || String(err) });
    }
  });

  fastify.post(`/${API_VERSION}/gateway/stop`, async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.code(200).send(await stopGateway());
    } catch (err: any) {
      reply.code(500).send({ message: err?.message || String(err) });
    }
  });

  fastify.post(`/${API_VERSION}/gateway/restart`, async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.code(200).send(await restartGateway());
    } catch (err: any) {
      reply.code(500).send({ message: err?.message || String(err) });
    }
  });

  fastify.post(
    `/${API_VERSION}/gateway/check-java`,
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = (req.body || {}) as { javaHome?: string };
        const javaHome = body.javaHome ?? getGatewaySettings().javaHome;
        reply.code(200).send(await checkJava(String(javaHome || '')));
      } catch (err: any) {
        reply.code(500).send({ message: err?.message || String(err) });
      }
    },
  );
};

export default api;
