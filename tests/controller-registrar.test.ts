import { describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, Next } from 'hono';
import { z } from 'zod';
import { Controller, Get, Query, Response as ResponseSchema, Post, Tags, registerController } from '../src/index.js';

@Controller({ path: '/widgets', tags: ['inventory', 'shared'] })
@Tags('controller')
class WidgetController {
    readonly prefix: string;

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    @Get('/{widgetId}')
    @Query(z.object({ include: z.string().optional() }))
    @ResponseSchema(z.object({ value: z.string() }), {
        description: 'Widget lookup.',
    })
    @Tags('shared', 'details')
    getWidget(context: { req: { param(name: string): string } }): Response {
        return Response.json({
            value: `${this.prefix}:${context.req.param('widgetId')}`,
        });
    }

    @Post('/', {
        responses: {
            201: {
                description: 'Widget created.',
                content: {
                    'application/json': {
                        schema: z.object({ created: z.literal(true) }),
                    },
                },
            },
        },
    })
    createWidget(): Response {
        return Response.json({ created: true }, { status: 201 });
    }
}

@Controller('/duplicate')
class DuplicateController {
    @Get('/', {
        responses: {
            200: {
                description: 'Duplicate.',
                content: { 'application/json': { schema: z.object({}) } },
            },
        },
    })
    getDuplicate(): Response {
        return Response.json({});
    }
}

@Controller('/duplicate')
class AnotherDuplicateController {
    @Get('/', {
        responses: {
            200: {
                description: 'Duplicate.',
                content: { 'application/json': { schema: z.object({}) } },
            },
        },
    })
    getDuplicate(): Response {
        return Response.json({});
    }
}

@Controller('/gated')
class GatedController {
    @Get('/', {
        responses: {
            200: { description: 'Gated.', content: { 'application/json': { schema: z.object({}) } } },
        },
    })
    getGated(): Response {
        return Response.json({});
    }

    @Post('/', {
        responses: {
            201: { description: 'Gated.', content: { 'application/json': { schema: z.object({}) } } },
        },
    })
    createGated(): Response {
        return Response.json({}, { status: 201 });
    }
}

async function requireTicket(context: Context, next: Next): Promise<Response | void> {
    if (context.req.header('x-ticket') === undefined) {
        return context.json({ detail: 'ticket required' }, 403);
    }
    await next();
}

describe('registerController', () => {
    test('registers controller routes with merged unique tags and preserved instance binding', async () => {
        const app = new OpenAPIHono();
        registerController(app, new WidgetController('widget'));

        const response = await app.request('/widgets/123');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ value: 'widget:123' });

        const document = app.getOpenAPIDocument({
            openapi: '3.0.0',
            info: { title: 'Controller test', version: '1.0.0' },
        });
        const operation = document.paths?.['/widgets/{widgetId}']?.get;
        expect(operation?.tags).toEqual(['inventory', 'shared', 'controller', 'details']);
        expect(document.paths?.['/widgets/']?.post).toBeDefined();
    });

    test('rejects a duplicate method and path on one router', () => {
        const app = new OpenAPIHono();
        registerController(app, new DuplicateController());

        expect(() => registerController(app, new AnotherDuplicateController())).toThrow(
            'Duplicate decorated route registration: get:/duplicate/',
        );
    });

    test('runs the middleware option on every route of that controller and on no other', async () => {
        const app = new OpenAPIHono();
        // Inline on purpose: a `never`-typed context would not compile here.
        registerController(app, new GatedController(), {
            middleware: [
                requireTicket,
                async (context, next) => {
                    await next();
                    context.res.headers.set('x-gated', 'yes');
                },
            ],
        });
        registerController(app, new WidgetController('widget'));

        const refused = await Promise.all([app.request('/gated/'), app.request('/gated/', { method: 'POST' })]);
        expect(refused.map(response => response.status)).toEqual([403, 403]);

        const admitted = await app.request('/gated/', { headers: { 'x-ticket': 'yes' } });
        expect(admitted.status).toBe(200);
        expect(admitted.headers.get('x-gated')).toBe('yes');

        const ungated = await app.request('/widgets/1');
        expect(ungated.status).toBe(200);
    });
});
