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
    console.log('Paths:', Object.keys(paths).length);
    console.log('Operations:', ops);
    console.log('Unique tags used:', tags.size);
    console.log('Tags:', [...tags].sort().join(', '));
  });
});
