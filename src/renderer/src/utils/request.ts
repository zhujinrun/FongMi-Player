import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { getPinia } from '@/utils/tool';

const baseURL = String(
  import.meta.env.DEV ? '/api' : `${import.meta.env.VITE_API_URL}${import.meta.env.VITE_API_URL_PREFIX}`,
);

const service: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
});

// @ts-ignore
service.interceptors.request.use((config: AxiosRequestConfig) => {
  return config;
});

service.interceptors.response.use(
  (response: AxiosResponse) => {
    const res = response;
    return res;
  },
  (error: AxiosError) => {
    const { response } = error;
    const data = response?.data as any;
    if (data?.code === 301 && data?.message === '未登录') {
      console.log('未登录');
    }
    return Promise.reject(error);
  },
);

const request = async (config: AxiosRequestConfig) => {
  if (!config?.timeout) {
    const url = String(config?.url || '');
    // Gateway catvod / absolute spider endpoints often need >5s
    if (/^https?:\/\//i.test(url)) {
      config.timeout = 60000;
    } else {
      const TIMEOUT = getPinia('setting', 'timeout') < 1000 ? 1000 : getPinia('setting', 'timeout');
      config.timeout = TIMEOUT;
    }
  }
  const { data } = await service.request(config);
  return data as any;
};

const requestComplete: any = async (config: AxiosRequestConfig) => {
  if (!config?.timeout) {
    const url = String(config?.url || '');
    if (/^https?:\/\//i.test(url)) {
      config.timeout = 60000;
    } else {
      const TIMEOUT = getPinia('setting', 'timeout') < 1000 ? 1000 : getPinia('setting', 'timeout');
      config.timeout = TIMEOUT;
    }
  }
  const { status, data, headers } = await service.request(config);
  return {
    status,
    data,
    headers,
  };
};

export { request as default, requestComplete };
