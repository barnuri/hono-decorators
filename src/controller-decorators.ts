import type { ZodTypeAny } from 'zod';
import type { RouteOperationOptions } from './controller-metadata.js';
import {
    finalizeController,
    recordBodySchema,
    recordController,
    recordControllerTags,
    recordHeaderSchema,
    recordParamSchema,
    recordQuerySchema,
    recordResponseSchema,
    recordRoute,
    recordRouteTags,
    type HttpMethod,
} from './controller-metadata.js';

export interface ControllerOptions {
    readonly path: string;
    readonly tags?: readonly string[] | false;
}

export interface ResponseOptions {
    readonly status?: number;
    readonly description: string;
    readonly contentType?: string;
}

type ControllerMethodDecorator = (value: Function, context: ClassMethodDecoratorContext) => void;

type ControllerDecorator = (value: Function, context: ClassDecoratorContext) => void;

type TagsDecorator = ControllerDecorator & ControllerMethodDecorator;

const DEFAULT_JSON_CONTENT_TYPE = 'application/json';
const DEFAULT_RESPONSE_STATUS = 200;

function controllerOptions(pathOrOptions: string | ControllerOptions): ControllerOptions {
    if (typeof pathOrOptions === 'string') {
        return { path: pathOrOptions };
    }
    return pathOrOptions;
}

/** Derives the fallback OpenAPI tag from a controller class name. */
function defaultTag(className: string): string {
    const stripped: string = className.replace(/Controller$/u, '');
    const name: string = stripped === '' ? className : stripped;
    return name.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase();
}

function resolveControllerTags(tags: readonly string[] | false | undefined, className: string): readonly string[] {
    if (tags === false) {
        return [];
    }
    return tags ?? [defaultTag(className)];
}

function assertPublicInstanceMethod(
    context: Pick<ClassMethodDecoratorContext, 'private' | 'static'>,
    decoratorName: string,
): void {
    if (context.private || context.static) {
        throw new TypeError(`${decoratorName} supports public instance methods only`);
    }
}

function createHttpMethodDecorator(
    method: HttpMethod,
): (path: string, operation?: RouteOperationOptions) => ControllerMethodDecorator {
    return (path: string, operation: RouteOperationOptions = {}): ControllerMethodDecorator => {
        return (_value: Function, context: ClassMethodDecoratorContext): void => {
            assertPublicInstanceMethod(context, `@${method.toUpperCase()}`);
            recordRoute(context, method, path, operation);
        };
    };
}

function createSchemaDecorator(
    decoratorName: string,
    record: (context: ClassMethodDecoratorContext, schema: ZodTypeAny) => void,
): (schema: ZodTypeAny) => ControllerMethodDecorator {
    return (schema: ZodTypeAny): ControllerMethodDecorator => {
        return (_value: Function, context: ClassMethodDecoratorContext): void => {
            assertPublicInstanceMethod(context, decoratorName);
            record(context, schema);
        };
    };
}

/**
 * Declares a controller base path and its OpenAPI tags, which default to the
 * kebab-cased class name without its Controller suffix; pass false for none.
 */
export function Controller(path: string): ControllerDecorator;
export function Controller(options: ControllerOptions): ControllerDecorator;
export function Controller(pathOrOptions: string | ControllerOptions): ControllerDecorator {
    const options: ControllerOptions = controllerOptions(pathOrOptions);
    return (_value: Function, context: ClassDecoratorContext): void => {
        if (context.name === undefined) {
            throw new TypeError('@Controller requires a named class');
        }
        recordController(context, options.path, resolveControllerTags(options.tags, context.name));
        context.addInitializer(function (this: Function): void {
            finalizeController(this, context.metadata);
        });
    };
}

/** Adds OpenAPI tags at either controller or endpoint scope. */
export function Tags(...tags: string[]): TagsDecorator {
    return ((_value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext): void => {
        if (context.kind === 'class') {
            recordControllerTags(context, tags);
            return;
        }
        assertPublicInstanceMethod(context, '@Tags');
        recordRouteTags(context, tags);
    }) as TagsDecorator;
}

/** Declares an endpoint query schema while preserving a typed handler contract. */
export const Query = createSchemaDecorator('@Query', recordQuerySchema);

/** Declares an endpoint JSON request-body schema while preserving a typed handler contract. */
export const Body = createSchemaDecorator('@Body', (context, schema) =>
    recordBodySchema(context, schema, DEFAULT_JSON_CONTENT_TYPE),
);

/** Declares an endpoint path-parameter schema while preserving a typed handler contract. */
export const Param = createSchemaDecorator('@Param', recordParamSchema);

/** Declares an endpoint request-header schema while preserving a typed handler contract. */
export const Headers = createSchemaDecorator('@Headers', recordHeaderSchema);

/** Declares an endpoint response schema and OpenAPI response without reflection. */
export function Response(schema: ZodTypeAny, options: ResponseOptions): ControllerMethodDecorator {
    return (_value: Function, context: ClassMethodDecoratorContext): void => {
        assertPublicInstanceMethod(context, '@Response');
        recordResponseSchema(context, {
            status: options.status ?? DEFAULT_RESPONSE_STATUS,
            description: options.description,
            contentType: options.contentType ?? DEFAULT_JSON_CONTENT_TYPE,
            schema,
        });
    };
}

export const Get = createHttpMethodDecorator('get');
export const Post = createHttpMethodDecorator('post');
export const Put = createHttpMethodDecorator('put');
export const Patch = createHttpMethodDecorator('patch');
export const Delete = createHttpMethodDecorator('delete');
export const Options = createHttpMethodDecorator('options');
export const Head = createHttpMethodDecorator('head');
