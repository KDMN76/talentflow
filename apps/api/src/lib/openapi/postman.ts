/**
 * Lightweight OpenAPI 3.x → Postman Collection 2.1 mapper.
 *
 * Geen externe dependency — basic mapping is voldoende voor een MVP-export.
 * Voor power-users adviseren we het officiële `openapi-to-postmanv2`-tool;
 * dit endpoint dient om snel een import-collection in Postman/Insomnia/Bruno
 * te krijgen.
 *
 * Ondersteunt: methods, path-templating, query-params, JSON-bodies,
 * security (Bearer + API key). Folders gegroepeerd op de eerste tag.
 */

interface OpenApiSpecLike {
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  paths?: Record<
    string,
    Record<
      string,
      {
        summary?: string;
        description?: string;
        tags?: string[];
        parameters?: Array<{
          name: string;
          in: string;
          required?: boolean;
          schema?: { type?: string; example?: unknown };
          description?: string;
        }>;
        requestBody?: {
          content?: Record<string, { schema?: unknown }>;
        };
        security?: Array<Record<string, unknown>>;
      }
    >
  >;
}

interface PostmanRequest {
  name: string;
  request: {
    method: string;
    header: Array<{ key: string; value: string; type?: string }>;
    url: {
      raw: string;
      host: string[];
      path: string[];
      query?: Array<{ key: string; value: string; description?: string; disabled?: boolean }>;
      variable?: Array<{ key: string; value: string; description?: string }>;
    };
    body?: { mode: 'raw'; raw: string; options?: { raw: { language: string } } };
    description?: string;
    auth?: unknown;
  };
}

interface PostmanFolder {
  name: string;
  item: PostmanRequest[];
}

export interface PostmanCollection {
  info: {
    _postman_id: string;
    name: string;
    description: string;
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
  };
  item: PostmanFolder[];
  auth: unknown;
  variable: Array<{ key: string; value: string; type?: string }>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

export function openApiToPostman(spec: OpenApiSpecLike): PostmanCollection {
  const baseUrl = spec.servers?.[0]?.url ?? 'http://localhost:4000';
  const folders = new Map<string, PostmanFolder>();

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = methods[method];
      if (!op) continue;

      const tag = op.tags?.[0] ?? 'Untagged';
      if (!folders.has(tag)) folders.set(tag, { name: tag, item: [] });

      const queryParams = (op.parameters ?? []).filter((p) => p.in === 'query');
      const pathParams = (op.parameters ?? []).filter((p) => p.in === 'path');

      // Postman path-tokens: /{id} → /:id with `variable`-entries
      const postmanPath = path.replace(/\{([^}]+)\}/g, ':$1');
      const segments = postmanPath.split('/').filter(Boolean);

      const request: PostmanRequest = {
        name: op.summary ?? `${method.toUpperCase()} ${path}`,
        request: {
          method: method.toUpperCase(),
          header: [{ key: 'Content-Type', value: 'application/json', type: 'text' }],
          url: {
            raw: `{{baseUrl}}${postmanPath}`,
            host: ['{{baseUrl}}'],
            path: segments,
            ...(queryParams.length
              ? {
                  query: queryParams.map((p) => ({
                    key: p.name,
                    value: String(p.schema?.example ?? ''),
                    description: p.description,
                    disabled: !p.required,
                  })),
                }
              : {}),
            ...(pathParams.length
              ? {
                  variable: pathParams.map((p) => ({
                    key: p.name,
                    value: String(p.schema?.example ?? ''),
                    description: p.description,
                  })),
                }
              : {}),
          },
          description: op.description ?? op.summary,
        },
      };

      // Body
      const jsonContent = op.requestBody?.content?.['application/json'];
      if (jsonContent) {
        request.request.body = {
          mode: 'raw',
          raw: '{}',
          options: { raw: { language: 'json' } },
        };
      }

      folders.get(tag)!.item.push(request);
    }
  }

  // Sort folders alphabetically for determinism
  const sortedFolders = Array.from(folders.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return {
    info: {
      _postman_id: '00000000-0000-0000-0000-000000000000',
      name: spec.info.title,
      description:
        (spec.info.description ?? '') +
        '\n\n— Auto-generated van OpenAPI spec via /api-docs/postman.json',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: sortedFolders,
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
    variable: [
      { key: 'baseUrl', value: baseUrl, type: 'string' },
      { key: 'accessToken', value: '', type: 'string' },
      { key: 'apiKey', value: '', type: 'string' },
    ],
  };
}
