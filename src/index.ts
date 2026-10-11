export {
    Body,
    Controller,
    Delete,
    Get,
    Head,
    Headers,
    Options,
    Param,
    Patch,
    Post,
    Put,
    Query,
    Response,
    Tags,
    type ControllerOptions,
    type ResponseOptions,
} from './controller-decorators.js';
export {
    registerController,
    type DecoratedController,
    type OpenApiRouter,
    type RegisterControllerOptions,
} from './controller-registrar.js';
export type { HttpMethod, RouteOperation, RouteOperationOptions } from './controller-metadata.js';
