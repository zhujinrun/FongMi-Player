import { FastifyReply, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fetch from 'node-fetch';

import {
  checkJava,
  gatewayBase,
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

  fastify.post(`/${API_VERSION}/gateway/start`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (req.body || {}) as Record<string, any>;
      reply.code(200).send(await startGateway(body));
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

  fastify.post(`/${API_VERSION}/gateway/restart`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (req.body || {}) as Record<string, any>;
      reply.code(200).send(await restartGateway(body));
    } catch (err: any) {
      reply.code(500).send({ message: err?.message || String(err) });
    }
  });

  fastify.post(
    `/${API_VERSION}/gateway/check-java`,
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = (req.body || {}) as { javaHome?: string };
        const javaHome = body.javaHome || getGatewaySettings().javaHome;
        reply.code(200).send(await checkJava(String(javaHome || '')));
      } catch (err: any) {
        reply.code(500).send({ message: err?.message || String(err) });
      }
    },
  );

  // 热切换：持久化配置地址（含历史）→ 让运行中的 Gateway POST /config 重载
  fastify.post(
    `/${API_VERSION}/gateway/apply-config`,
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = (req.body || {}) as { configUrl?: string; gatewayBase?: string };
        const configUrl = String(body.configUrl || '').trim();
        if (!configUrl) {
          reply.code(400).send({ message: 'configUrl is required' });
          return;
        }
        const saved = saveGatewaySettings({ config: configUrl });
        const base = String(body.gatewayBase || gatewayBase()).replace(/\/$/, '');
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 180000);
        let applied = false;
        let siteCount: number | undefined;
        let message = '';
        try {
          const res = await fetch(`${base}/config?url=${encodeURIComponent(configUrl)}`, {
            method: 'POST',
            body: '{}',
            headers: { 'Content-Type': 'application/json' },
            signal: ac.signal,
          });
          const text = await res.text();
          let data: {
            message?: string;
            raw?: string;
            siteCount?: number;
            data?: { message?: string; siteCount?: number };
          } = {};
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text };
          }
          if (!res.ok) {
            throw new Error(
              data?.message || data?.data?.message || data?.raw || `gateway ${res.status}`,
            );
          }
          applied = true;
          siteCount = data?.siteCount ?? data?.data?.siteCount;
        } catch (e) {
          message =
            e instanceof Error
              ? e.name === 'AbortError'
                ? 'gateway /config timeout'
                : e.message
              : String(e);
        } finally {
          clearTimeout(timer);
        }
        reply.code(200).send({
          applied,
          saved: true,
          config: configUrl,
          configHistory: saved.configHistory,
          siteCount,
          message: applied ? '' : `配置已保存，网关热切换失败：${message}`,
        });
      } catch (err) {
        reply.code(500).send({ message: err instanceof Error ? err.message : String(err) });
      }
    },
  );
};

export default api;
