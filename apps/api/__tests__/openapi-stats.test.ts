import { describe, it } from 'vitest';
import { getOpenApiSpec } from '../src/lib/openapi';

describe('stats', () => {
  it('count', () => {
    const spec = getOpenApiSpec() as any;
    const paths = spec.paths;
    let ops = 0;
    const tags = new Set<string>();
    const httpMethods = ['get', 'post', 'put', 'patch', 'delete'];
    for (const [, methods] of Object.entries(paths)) {
      for (const [meth, op] of Object.entries(methods as any)) {
        if (httpMethods.includes(meth)) {
          ops++;
          for (const t of (op as any).tags || []) tags.add(t);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log('STATS_PATHS=', Object.keys(paths).length);
    console.log('STATS_OPS=', ops);
    console.log('STATS_TAGS_USED=', tags.size);
    console.log('STATS_TAG_LIST=', [...tags].sort().join('|'));
  });
});
