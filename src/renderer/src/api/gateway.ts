import request from '@/utils/request';

export function fetchGatewayStatus() {
  return request({
    url: '/v1/gateway/status',
    method: 'get',
  });
}

export function fetchGatewaySettings() {
  return request({
    url: '/v1/gateway/settings',
    method: 'get',
  });
}

export function saveGatewaySettings(data) {
  return request({
    url: '/v1/gateway/settings',
    method: 'put',
    data,
  });
}

export function startGateway() {
  return request({
    url: '/v1/gateway/start',
    method: 'post',
    data: {},
  });
}

export function stopGateway() {
  return request({
    url: '/v1/gateway/stop',
    method: 'post',
    data: {},
  });
}

export function restartGateway() {
  return request({
    url: '/v1/gateway/restart',
    method: 'post',
    data: {},
  });
}

export function checkGatewayJava(javaHome?: string) {
  return request({
    url: '/v1/gateway/check-java',
    method: 'post',
    data: { javaHome: javaHome || '' },
  });
}
