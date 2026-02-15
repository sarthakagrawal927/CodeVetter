import { GatewayConfig, GatewayReviewRequest, GatewayReviewResponse } from '../../shared-types/src';
export declare function reviewDiffWithOpenAICompatibleGateway(config: GatewayConfig, request: GatewayReviewRequest): Promise<GatewayReviewResponse>;
