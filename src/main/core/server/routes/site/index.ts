import { FastifyReply, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fetch from 'node-fetch';
import { enlightentHot, kyLiveHot } from './hot';
import { classify, detail, get_hipy_play_url, get_drpy_play_url, check, search, list } from './cms';

import { site, setting } from '../../../db/service';

const API_VERSION = 'api/v1';
const GATEWAY_DEFAULT = 'http://127.0.0.1:9979';

async function gatewayJson(url: string, init?: any): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      throw new Error(body?.message || body?.raw || `gateway ${res.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Load TVBox config into Gateway (optional) then mirror /sites as catvod[api] type8. */
async function syncFromGateway(configUrl: string, gatewayBase: string) {
  const base = (gatewayBase || GATEWAY_DEFAULT).replace(/\/$/, '');
  if (configUrl) {
    await gatewayJson(`${base}/config?url=${encodeURIComponent(configUrl)}`, { method: 'POST', body: '{}' });
  }
  const sitesRes = await gatewayJson(`${base}/sites`);
  const list: any[] = Array.isArray(sitesRes?.data) ? sitesRes.data : [];
  const existing = site.all() || [];
  const byApi = new Map<string, any>();
  for (const row of existing) {
    if (row?.api) byApi.set(String(row.api), row);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const g of list) {
    const key = g?.key;
    const gApi = String(g?.api || '');
    // skip hide, pure JS drpy rules, and empty keys — gateway can't run them as csp jar
    if (!key || g.hide || gApi.includes('.js')) {
      skipped += 1;
      continue;
    }
    const api = `${base}/${encodeURIComponent(key)}`;
    const doc = {
      name: g.name || key,
      api,
      type: 8,
      search: g.searchable ? (g.quickSearch ? 1 : 2) : 0,
      ext: '',
      playUrl: '',
      group: '网关',
      categories: '',
      isActive: true,
    };
    const hit = byApi.get(api);
    if (hit?.id) {
      await site.update(hit.id, doc);
      updated += 1;
    } else {
      await site.add(doc);
      created += 1;
    }
  }
  return { gateway: base, total: list.length, created, updated, skipped };
}

const api: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.post(
    `/${API_VERSION}/site/sync-gateway`,
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = (req.body || {}) as { configUrl?: string; gatewayBase?: string };
        const res = await syncFromGateway(body.configUrl || '', body.gatewayBase || GATEWAY_DEFAULT);
        reply.code(200).send(res);
      } catch (err: any) {
        reply.code(500).send({ message: err?.message || String(err) });
      }
    },
  );
  fastify.post(
    `/${API_VERSION}/site`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const res = await site.add(req.body);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.delete(
    `/${API_VERSION}/site/:id`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const idStr = req.params.id;
        const idList = idStr.split(',');
        // 使用 Promise.all() 并行执行所有删除操作
        await Promise.all(
          idList.map(async (item) => {
            await site.remove(item);
          }),
        );
        reply.code(200);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.put(
    `/${API_VERSION}/site/status/:status/:id`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { status, id } = req.params;
        const validStatuses = ['enable', 'disable'];

        if (!validStatuses.includes(status)) {
          throw new Error('Invalid status value. Must be "enable" or "disable".');
        }

        const idList = id.split(',');

        await Promise.all(
          idList.map(async itemId => {
            const currentData = await site.get(itemId);
            const updatedData = { ...currentData, isActive: status === 'enable' };
            await site.update(itemId, updatedData);
          }),
        );
        reply.code(200);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/site/:id`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const res = await site.get(req.params.id);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.put(
    `/${API_VERSION}/site/:id`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const res = await site.update(req.params.id, req.body);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(`/${API_VERSION}/site/list`, async (_, reply: FastifyReply) => {
    try {
      const data = await site.all();
      const tacitly = await setting.find({ key: 'defaultSite' }).value;
      const res = {
        data,
        default: tacitly,
      };
      reply.code(200).send(res);
    } catch (err) {
      reply.code(500).send(err);
    }
  });
  fastify.get(
    `/${API_VERSION}/site/search`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { kw } = req.query;
        const res = await site.all(kw);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/site/page`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { kw } = req.query;
        const page = await site.pagination(kw);
        const tacitly = await setting.find({ key: 'defaultSite' }).value;
        const res = {
          data: page.data,
          total: page.total,
          default: tacitly,
        };
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(`/${API_VERSION}/site/active`, async (_, reply: FastifyReply) => {
    try {
      const data = await site.filter({ isActive: true });
      const tacitly_id = await setting.find({ key: 'defaultSite' }).value;
      const tacitly = (await site.find({ id: tacitly_id })) || {};
      const search = await setting.find({ key: 'defaultSearchType' }).value;
      const filter = await setting.find({ key: 'defaultFilterType' }).value;
      const group = await site.group().data;
      const res = {
        data,
        search,
        group,
        filter,
        default: tacitly,
      };
      reply.code(200).send(res);
    } catch (err) {
      reply.code(500).send(err);
    }
  });
  fastify.get(`/${API_VERSION}/site/group`, async (_, reply: FastifyReply) => {
    try {
      const res = await site.group();
      reply.code(200).send(res);
    } catch (err) {
      reply.code(500).send(err);
    }
  });
  fastify.get(
    `/${API_VERSION}/hot/enlightent`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { date, sort, channelType, day } = req.query;
        const res = await enlightentHot(date, sort, channelType, day);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/hot/ky`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { date, type, plat } = req.query;
        const res = await kyLiveHot(date, type, plat);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/film/class`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { id } = req.query;
        const res = await classify(id);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/film/get_hipy_play_url`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { id, flag, play } = req.query;
        const res = await get_hipy_play_url(id, flag, play);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/film/get_drpy_play_url`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { id, url } = req.query;
        const res = await get_drpy_play_url(id, url);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/film/check`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { id } = req.query;
        const res = await check(id);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/film/search`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { id, kw } = req.query;
        const res = await search(id, kw);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/film/list`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        let { id, pg, t, f } = req.query;
        if (!pg) pg = 1;
        if (!f) f = {};
        const res = await list(id, pg, t, f);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
  fastify.get(
    `/${API_VERSION}/film/detail`,
    async (req: FastifyRequest<{ Querystring: { [key: string]: string } }>, reply: FastifyReply) => {
      try {
        const { id, video_id } = req.query;
        const res = await detail(id, video_id);
        reply.code(200).send(res);
      } catch (err) {
        reply.code(500).send(err);
      }
    },
  );
};

export default api;
