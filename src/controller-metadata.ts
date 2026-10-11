import type { RouteConfig } from '@hono/zod-openapi';
import type { ZodTypeAny } from 'zod';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export type RouteOperation = Omit<RouteConfig, 'method' | 'path' | 'tags'>;

export type RouteOperationOptions = Omit<RouteOperation, 'request' | 'responses'> & {
    readonly request?: RouteOperation['request'];
    readonly responses?: RouteOperation['responses'];
};

export interface ControllerDefinition {
    readonly basePath: string;
    readonly tags: readonly string[];
}

export interface RouteDefinition {
    readonly method: HttpMethod;
    readonly path: string;
    readonly operation: RouteOperation;
    readonly tags: readonly string[];
}

interface RequestSchemas {
    readonly query?: ZodTypeAny;
    readonly params?: ZodTypeAny;
    readonly headers?: ZodTypeAny;
    readonly body?: {
        readonly contentType: string;
        readonly schema: ZodTypeAny;
    };
}

interface ResponseSchema {
    readonly status: number;
    readonly description: string;
    readonly contentType: string;
    readonly schema: ZodTypeAny;
}

interface IncompleteRouteDefinition {
    readonly method?: HttpMethod;
    readonly path?: string;
    readonly operation?: RouteOperationOptions;
    readonly tags: readonly string[];
    readonly requestSchemas: RequestSchemas;
    readonly responses: readonly ResponseSchema[];
}

type ControllerMetadata = DecoratorMetadataObject & {
    [controllerBasePath]?: string;
    [controllerTags]?: readonly string[];
    [routeDefinitions]?: Map<string | symbol, IncompleteRouteDefinition>;
};

const controllerBasePath = Symbol('hono-decorators.controller.base-path');
const controllerTags = Symbol('hono-decorators.controller.tags');
const routeDefinitions = Symbol('hono-decorators.controller.routes');

const controllerDefinitionsByConstructor = new WeakMap<Function, ControllerDefinition>();
const routeDefinitionsByConstructor = new WeakMap<Function, ReadonlyMap<string | symbol, RouteDefinition>>();

function metadataOf(
    context: Pick<ClassDecoratorContext | ClassMethodDecoratorContext, 'metadata'>,
): ControllerMetadata {
    if (context.metadata === undefined) {
        throw new TypeError('This runtime does not support Stage-3 decorator metadata');
    }
    return context.metadata as ControllerMetadata;
}

function normalizedTags(tags: readonly string[]): readonly string[] {
    return [...new Set(tags.filter((tag: string): boolean => tag !== ''))];
}

function routeDefinitionMap(metadata: ControllerMetadata): Map<string | symbol, IncompleteRouteDefinition> {
    const existing: Map<string | symbol, IncompleteRouteDefinition> | undefined = metadata[routeDefinitions];
    if (existing !== undefined) {
        return existing;
    }
    const definitions = new Map<string | symbol, IncompleteRouteDefinition>();
    metadata[routeDefinitions] = definitions;
    return definitions;
}

function emptyRouteDefinition(): IncompleteRouteDefinition {
    return { tags: [], requestSchemas: {}, responses: [] };
}

function currentRouteDefinition(metadata: ControllerMetadata, name: string | symbol): IncompleteRouteDefinition {
    return routeDefinitionMap(metadata).get(name) ?? emptyRouteDefinition();
}

function setIncompleteRouteDefinition(
    metadata: ControllerMetadata,
    name: string | symbol,
    definition: IncompleteRouteDefinition,
): void {
    routeDefinitionMap(metadata).set(name, definition);
}

function requestFromSchemas(
    operation: RouteOperationOptions | undefined,
    schemas: RequestSchemas,
): RouteOperation['request'] | undefined {
    const body =
        schemas.body === undefined
            ? operation?.request?.body
            : {
                  content: {
                      [schemas.body.contentType]: { schema: schemas.body.schema },
                  },
              };
    const query = schemas.query ?? operation?.request?.query;
    const params = schemas.params ?? operation?.request?.params;
    const headers = schemas.headers ?? operation?.request?.headers;
    if (body === undefined && query === undefined && params === undefined && headers === undefined) {
        return undefined;
    }
    return { body, query, params, headers } as RouteOperation['request'];
}

function responsesFromSchemas(
    operation: RouteOperationOptions | undefined,
    schemas: readonly ResponseSchema[],
): RouteOperation['responses'] | undefined {
    const responses = { ...(operation?.responses ?? {}) };
    for (const schema of schemas) {
        responses[schema.status] = {
            description: schema.description,
            content: {
                [schema.contentType]: { schema: schema.schema },
            },
        };
    }
    return Object.keys(responses).length === 0 ? undefined : responses;
}

function completeRouteDefinitions(metadata: ControllerMetadata): ReadonlyMap<string | symbol, RouteDefinition> {
    const definitions = new Map<string | symbol, RouteDefinition>();
    for (const [name, definition] of metadata[routeDefinitions] ?? []) {
        const request = requestFromSchemas(definition.operation, definition.requestSchemas);
        const responses = responsesFromSchemas(definition.operation, definition.responses);
        if (
            definition.method === undefined ||
            definition.path === undefined ||
            definition.operation === undefined ||
            responses === undefined
        ) {
            throw new TypeError(`Decorated route ${String(name)} is missing an HTTP method or response decorator`);
        }
        definitions.set(name, {
            method: definition.method,
            path: definition.path,
            operation: {
                ...definition.operation,
                request,
                responses,
            } as RouteOperation,
            tags: definition.tags,
        });
    }
    return definitions;
}

export function recordController(context: ClassDecoratorContext, basePath: string, tags: readonly string[]): void {
    const metadata = metadataOf(context);
    metadata[controllerBasePath] = basePath;
    metadata[controllerTags] = normalizedTags([...tags, ...(metadata[controllerTags] ?? [])]);
}

export function recordControllerTags(context: ClassDecoratorContext, tags: readonly string[]): void {
    const metadata = metadataOf(context);
    metadata[controllerTags] = normalizedTags([...(metadata[controllerTags] ?? []), ...tags]);
}

export function recordRoute(
    context: Pick<ClassMethodDecoratorContext, 'metadata' | 'name'>,
    method: HttpMethod,
    path: string,
    operation: RouteOperationOptions,
): void {
    const metadata = metadataOf(context);
    const existing = currentRouteDefinition(metadata, context.name);
    setIncompleteRouteDefinition(metadata, context.name, {
        ...existing,
        method,
        path,
        operation,
    });
}

export function recordRouteTags(
    context: Pick<ClassMethodDecoratorContext, 'metadata' | 'name'>,
    tags: readonly string[],
): void {
    const metadata = metadataOf(context);
    const existing = currentRouteDefinition(metadata, context.name);
    setIncompleteRouteDefinition(metadata, context.name, {
        ...existing,
        tags: normalizedTags([...(existing.tags ?? []), ...tags]),
    });
}

export function recordQuerySchema(
    context: Pick<ClassMethodDecoratorContext, 'metadata' | 'name'>,
    schema: ZodTypeAny,
): void {
    const metadata = metadataOf(context);
    const existing = currentRouteDefinition(metadata, context.name);
    setIncompleteRouteDefinition(metadata, context.name, {
        ...existing,
        requestSchemas: { ...existing.requestSchemas, query: schema },
    });
}

export function recordParamSchema(
    context: Pick<ClassMethodDecoratorContext, 'metadata' | 'name'>,
    schema: ZodTypeAny,
): void {
    const metadata = metadataOf(context);
    const existing = currentRouteDefinition(metadata, context.name);
    setIncompleteRouteDefinition(metadata, context.name, {
        ...existing,
        requestSchemas: { ...existing.requestSchemas, params: schema },
    });
}

export function recordHeaderSchema(
    context: Pick<ClassMethodDecoratorContext, 'metadata' | 'name'>,
    schema: ZodTypeAny,
): void {
    const metadata = metadataOf(context);
    const existing = currentRouteDefinition(metadata, context.name);
    setIncompleteRouteDefinition(metadata, context.name, {
        ...existing,
        requestSchemas: { ...existing.requestSchemas, headers: schema },
    });
}

export function recordBodySchema(
    context: Pick<ClassMethodDecoratorContext, 'metadata' | 'name'>,
    schema: ZodTypeAny,
    contentType: string,
): void {
    const metadata = metadataOf(context);
    const existing = currentRouteDefinition(metadata, context.name);
    setIncompleteRouteDefinition(metadata, context.name, {
        ...existing,
        requestSchemas: {
            ...existing.requestSchemas,
            body: { schema, contentType },
        },
    });
}

export function recordResponseSchema(
    context: Pick<ClassMethodDecoratorContext, 'metadata' | 'name'>,
    response: ResponseSchema,
): void {
    const metadata = metadataOf(context);
    const existing = currentRouteDefinition(metadata, context.name);
    setIncompleteRouteDefinition(metadata, context.name, {
        ...existing,
        responses: [...existing.responses, response],
    });
}

export function finalizeController(constructor: Function, metadata: DecoratorMetadataObject | undefined): void {
    if (metadata === undefined) {
        throw new TypeError('This runtime does not support Stage-3 decorator metadata');
    }
    const controllerMetadata = metadata as ControllerMetadata;
    const basePath: string | undefined = controllerMetadata[controllerBasePath];
    if (basePath === undefined) {
        throw new TypeError('Controller instances must use @Controller before registration');
    }
    controllerDefinitionsByConstructor.set(constructor, {
        basePath,
        tags: controllerMetadata[controllerTags] ?? [],
    });
    routeDefinitionsByConstructor.set(constructor, completeRouteDefinitions(controllerMetadata));
}

export function getControllerDefinition(constructor: Function): ControllerDefinition | undefined {
    return controllerDefinitionsByConstructor.get(constructor);
}

export function getRouteDefinitions(constructor: Function): ReadonlyMap<string | symbol, RouteDefinition> {
    return routeDefinitionsByConstructor.get(constructor) ?? new Map();
}
