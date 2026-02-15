import { GatewayConfig, GatewayReviewRequest, GatewayReviewResponse } from '../../shared-types/src';
export declare class AIGatewayClient {
    private config;
    constructor(config: GatewayConfig);
    reviewDiff(request: GatewayReviewRequest): Promise<GatewayReviewResponse>;
}
