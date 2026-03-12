import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<700'],
  },
};

export default function () {
  http.get('https://mg-api.ariedam.fr/data', {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  sleep(0.2);
}
