import { describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { Controller, Get, Response as ResponseSchema, Tags, registerController } from '../src/index.js';

const okSchema = z.object({ ok: z.literal(true) });

function ok(): Response {
    return Response.json({ ok: true });
}

function tagsOf(controller: object, path: string): readonly string[] | undefined {
    const router = new OpenAPIHono();
    registerController(router, controller);
    const document = router.getOpenAPIDocument({
        openapi: '3.0.0',
        info: { title: 'tags', version: '1.0.0' },
    });
    return document.paths?.[path]?.get?.tags;
}

@Controller({ path: '/auth-helper' })
class AuthHelperController {
    @Get('/status')
    @ResponseSchema(okSchema, { description: 'Status.' })
    getStatus(): Response {
        return ok();
    }
}

@Controller('/plain')
class PlainController {
    @Get('/status')
    @ResponseSchema(okSchema, { description: 'Status.' })
    getStatus(): Response {
        return ok();
    }
}

@Controller({ path: '/explicit', tags: ['chosen'] })
class ExplicitlyTaggedController {
    @Get('/status')
    @ResponseSchema(okSchema, { description: 'Status.' })
    getStatus(): Response {
        return ok();
    }
}

@Controller({ path: '/untagged', tags: false })
class UntaggedController {
    @Get('/status')
    @ResponseSchema(okSchema, { description: 'Status.' })
    getStatus(): Response {
        return ok();
    }
}

@Controller({ path: '/added', tags: false })
@Tags('manual')
class AddedTagsController {
    @Get('/status')
    @ResponseSchema(okSchema, { description: 'Status.' })
    getStatus(): Response {
        return ok();
    }
}

describe('controller tag defaults', () => {
    test('kebab-cases the class name and drops the Controller suffix', () => {
        expect(tagsOf(new AuthHelperController(), '/auth-helper/status')).toEqual(['auth-helper']);
    });

    test('applies to the string-path form too', () => {
        expect(tagsOf(new PlainController(), '/plain/status')).toEqual(['plain']);
    });

    test('an explicit list replaces the default rather than adding to it', () => {
        expect(tagsOf(new ExplicitlyTaggedController(), '/explicit/status')).toEqual(['chosen']);
    });

    test('tags: false omits the tags key entirely', () => {
        expect(tagsOf(new UntaggedController(), '/untagged/status')).toBeUndefined();
    });

    // WHY: @Tags is additive, so it is the only way to tag a controller that opted out of the default.
    test('tags: false still lets @Tags contribute', () => {
        expect(tagsOf(new AddedTagsController(), '/added/status')).toEqual(['manual']);
    });
});
