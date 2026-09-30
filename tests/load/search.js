import http from 'k6/http';
import { check } from 'k6';

const base = __ENV.SEARCHFORGE_URL;
const key = __ENV.SEARCHFORGE_SEARCH_KEY;
if (!base || !key) throw new Error('Set SEARCHFORGE_URL and SEARCHFORGE_SEARCH_KEY; use an isolated benchmark project.');
const index = encodeURIComponent(__ENV.SEARCHFORGE_INDEX_SLUG || 'docs');
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
export const options = {
  scenarios: {
    search: { executor: 'constant-vus', exec: 'search', vus: Number(__ENV.VUS || 5), duration: __ENV.DURATION || '30s' },
    autocomplete: { executor: 'constant-vus', exec: 'autocomplete', vus: Number(__ENV.SUGGEST_VUS || 2), duration: __ENV.DURATION || '30s' }
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: { http_req_failed: ['rate<0.01'], checks: ['rate>0.99'] }
};
export function search() {
  const query = ['search engine', 'javscript', 'محرك البحث', 'تطبيع النص', '"distributed systems"'][__ITER % 5];
  const response = http.post(`${base}/v1/indexes/${index}/search`, JSON.stringify({ query, limit: 10, facets: ['metadata.category'] }), { headers, tags: { operation: 'search' } });
  check(response, { 'search returns versioned hits': result => result.status === 200 && Array.isArray(result.json('hits')) && !!result.json('indexVersion') });
}
export function autocomplete() {
  const response = http.get(`${base}/v1/indexes/${index}/autocomplete?q=prog&limit=8`, { headers, tags: { operation: 'autocomplete' } });
  check(response, { 'suggestions return successfully': result => result.status === 200 && Array.isArray(result.json('suggestions')) });
}
