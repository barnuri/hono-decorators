import { createRoute } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { getControllerDefinition, getRouteDefinitions, type RouteDefinition } from './controller-metadata.js';

export type DecoratedController = object;

/**
 * Structural on purpose: applications can install a different file-copy of
 * Hono than this package while still using the same runtime OpenAPI interface.
 */
export interface OpenApiRouter {
    openapi(route: unknown, handler: unknown): unknown;
}

export interface RegisterControllerOptions {
    readonly basePath?: string;
    /**
     * Runs before the validators on every route the controller declares, so a
     * gate one whole controller needs follows the controller instead of a path
     * list kept beside it.
     */
    readonly middleware?: MiddlewareHandler[];
}

const registeredRoutes = new WeakMap<object, Set<string>>();

function joinPaths(basePath: string, routePath: string): string {
    const normalizedBasePath: string = basePath === '/' ? '' : basePath.replace(/\/+$/, '');
    const normalizedRoutePath: string = routePath.startsWith('/') ? routePath : `/${routePath}`;
    return `${normalizedBasePath}${normalizedRoutePath}` || '/';
}

function routeKey(definition: RouteDefinition, path: string): string {
    return `${definition.method}:${path}`;
}

function registeredRouteSet(router: object): Set<string> {
    const existing: Set<string> | undefined = registeredRoutes.get(router);
    if (existing !== undefined) {
        return existing;
    }
    const routes = new Set<string>();
    registeredRoutes.set(router, routes);
    return routes;
}

function requireResponse(value: unknown): Response | Promise<Response> {
    if (value instanceof Promise) {
        return value.then(requireResponse);
    }
    if (value instanceof Response) {
        return value;
    }
    throw new TypeError('Decorated controller handlers must return a Response');
}

function controllerHandler(
    controller: DecoratedController,
    memberName: string | symbol,
): (context: unknown) => Response | Promise<Response> {
    const candidate: unknown = (controller as Record<string | symbol, unknown>)[memberName];
    if (typeof candidate !== 'function') {
        throw new TypeError(`Decorated route ${String(memberName)} is not a method`);
    }
    return (context: unknown): Response | Promise<Response> => {
        const result: unknown = candidate.call(controller, context);
        return requireResponse(result);
    };
}

/**
 * Registers a decorated controller through Hono's existing Zod OpenAPI
 * execution path, optionally overriding the class's declared base path and
 * putting middleware in front of each of its routes.
 */
export function registerController(
    router: OpenApiRouter,
    controller: DecoratedController,
    options: RegisterControllerOptions = {},
): void {
    const controllerDefinition = getControllerDefinition(controller.constructor);
    if (controllerDefinition === undefined) {
        throw new TypeError('Controller instances must use @Controller before registration');
    }
    const basePath: string = options.basePath ?? controllerDefinition.basePath;

    const routes: Set<string> = registeredRouteSet(router as object);
    for (const [memberName, definition] of getRouteDefinitions(controller.constructor)) {
        const path: string = joinPaths(basePath, definition.path);
        const key: string = routeKey(definition, path);
        if (routes.has(key)) {
            throw new Error(`Duplicate decorated route registration: ${key}`);
        }
        routes.add(key);
        const tags: string[] = [...new Set([...controllerDefinition.tags, ...definition.tags])];
        const route = createRoute({
            ...definition.operation,
            method: definition.method,
            path,
            // WHY: omitted rather than emitted empty, so an untagged controller matches
            // FastAPI's output byte for byte.
            ...(tags.length > 0 ? { tags } : {}),
            middleware: options.middleware,
        });
        router.openapi(route, controllerHandler(controller, memberName));
    }
}
