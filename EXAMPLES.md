# @barnuri/hono-decorators — examples

NestJS-shaped controllers over Hono. A decorated class declares the routes; the
registrar turns each method into an `@hono/zod-openapi` route, so the OpenAPI
document is generated from the same declaration that serves the request — the
way FastAPI generates its schema from the function signature.

Request and response schemas come from
[`@barnuri/zod-decorators`](https://github.com/barnuri/zod-decorators/blob/master/EXAMPLES.md) DTO classes.

## A controller

```ts
import { Controller, Get, Query, Response as ResponseSchema } from '@barnuri/hono-decorators';
import { ReportFiltersQueryDto } from '../schemas/filters.js';
import { SummaryPageDto } from '../schemas/pages.js';
import type { RouteContext } from './route-context.js';

type PageContext = RouteContext<ReportFiltersQueryDto>;

@Controller({ path: '/', tags: ['reports'] })
export class ReportsController {
    @Get('/summary', {
        summary: 'Get the summary report',
        description:
            'Returns order totals for the requested date range, broken down by category, plus a zero-filled daily time series.',
    })
    @Query(ReportFiltersQueryDto.schema)
    @ResponseSchema(SummaryPageDto.schema, { description: 'The summary report.' })
    async getSummary(context: PageContext): Promise<Response> {
        const page = await ReportService.getSummary(context.req.valid('query'));
        return context.json(SummaryPageDto.parse(page), 200);
    }
}
```

Register it — `new`, not the class:

```ts
const router = new OpenAPIHono({ defaultHook: validationHook });
registerController(router, new ReportsController());
```

Route metadata materialises in a class initializer, so a controller's routes
exist only once it is **instantiated**.

A controller whose every route needs a gate beyond the router-level auth takes
it as the `middleware` option. It runs before each route's validators, on every
route the controller declares, so a method added later is gated with no path
list to update:

```ts
registerController(router, new AdminController(), { middleware: [requireAdmin] });
```

## Decorator reference

| Decorator | Scope | Purpose |
| --- | --- | --- |
| `@Controller({ path, tags })` | class | Base path and OpenAPI tags. Tags default to the kebab-cased class name minus `Controller`; pass `tags: false` for none. |
| `@Get` `@Post` `@Put` `@Patch` `@Delete` `@Options` `@Head` | method | Verb, path, and the OpenAPI operation (`summary`, `description`, `operationId`, `deprecated`, extra `responses`). |
| `@Query(schema)` | method | Query-string schema. |
| `@Param(schema)` | method | Path-parameter schema. |
| `@Headers(schema)` | method | Request-header schema. |
| `@Body(schema)` | method | JSON request-body schema. |
| `@Response(schema, { status, description, contentType })` | method | One documented response. Repeat per status; `status` defaults to 200, `contentType` to `application/json`. |
| `@Tags(...tags)` | class or method | Adds tags at either scope. |

## Every method carries a summary and a description

The generated document is the API's documentation — a bare path and schema
leaves a client author guessing. `summary` is the one-line label in the route
list; `description` is the paragraph on the expanded operation. Say what the
endpoint returns, and what a caller would otherwise get wrong:

```ts
@Get('/readyz', {
    summary: 'Readiness probe',
    description:
        'Reports whether the process should receive traffic. It returns 200 with "OK" while the readiness gate is open, and 503 with "Shutting down" once graceful shutdown starts, so a load balancer drains this instance before it stops accepting connections. The body is plain text, not JSON.',
})
```

## A POST with a body and path parameters

```ts
@Controller({ path: '/', tags: ['books'] })
export class BookController {
    @Post('/books', {
        summary: 'Create a book',
        description: 'Creates a book and returns it with its assigned id.',
    })
    @Body(CreateBookDto.schema)
    @ResponseSchema(BookDto.schema, { status: 201, description: 'The created book.' })
    @ResponseSchema(ErrorDto.schema, { status: 409, description: 'A book with that title exists.' })
    async create(context: CreateBookContext): Promise<Response> {
        const book = await BookService.create(context.req.valid('json'));
        return context.json(BookDto.parse(book), 201);
    }

    @Get('/books/{bookId}', {
        summary: 'Get one book',
        description: 'Returns a single book by id. Answers 404 when it does not exist.',
    })
    @Param(BookParamsDto.schema)
    @ResponseSchema(BookDto.schema, { description: 'The book.' })
    @ResponseSchema(ErrorDto.schema, { status: 404, description: 'No such book.' })
    async getOne(context: BookParamsContext): Promise<Response> {
        // ...
    }
}
```

Path syntax is `{bookId}`, and the `@Param` DTO's field names must match.

## Non-JSON and redirect responses

```ts
@Get('/readyz', { summary: 'Readiness probe', description: '...' })
@ResponseSchema(z.literal('OK'), { description: 'Ready to serve traffic.', contentType: 'text/plain' })
@ResponseSchema(z.literal('Shutting down'), {
    status: 503,
    description: 'Draining — shutdown in progress.',
    contentType: 'text/plain',
})
getReadyz(context: DefaultRouteContext): Response {
    return this.gate.ready ? context.text('OK', 200) : context.text('Shutting down', 503);
}
```

A redirect has no body schema, so declare it through the operation's own
`responses`:

```ts
@Get('/login', {
    summary: 'Start the OAuth login.',
    description: '...',
    responses: {
        302: { description: 'Redirect to the identity provider.', headers: z.object({ Location: z.string() }) },
    },
})
```

## Constructor injection

A controller is a normal class — dependencies go through the constructor, and
the caller owns the wiring:

```ts
@Controller({ path: '/' })
export class DefaultController {
    constructor(
        private readonly appConfig: ApplicationBaseConfig,
        private readonly gate: ReadinessGate,
    ) {}
}

registerController(router, new DefaultController(appConfig, gate));
```

## Rules the registrar enforces

- **Handlers must return a `Response`** — `return context.json(payload, status)`.
  The registrar throws on anything else.
- **One router per prefix.** The duplicate `method:path` guard is per-router, so
  register every controller sharing a prefix onto the same `OpenAPIHono`.
- **Decorators are Stage-3** (`Symbol.metadata`, no `reflect-metadata`, no
  `experimentalDecorators`).

## Conventions that are not enforced but still hold

- **Mount, don't hardcode.** Keep the URL prefix in the router assembly
  (`router.route(PREFIX, controllerRouter())`), not in `@Controller`. Importing
  the prefix back into a controller creates a cycle with the router module.
- **Apply auth once at router level** over the prefix, never per endpoint — that
  is what stops a newly added route shipping ungated. A further gate that one
  whole controller needs goes on its registration as `{ middleware }`, never on
  a path list kept beside it.
- **`@Response` documents, it does not parse.** Call `<Dto>.parse(...)` before
  `context.json(...)`: that is what applies defaults and strips undeclared keys.
- **Type the handler context locally.** `registerController` types its context as
  `unknown` because it is structural across `file:` copies of Hono, so handlers
  get no inference from Hono. Widen one app-local interface (for example a
  `RouteContext<Query>` type in `routes/route-context.ts`) rather than casting per call site.
