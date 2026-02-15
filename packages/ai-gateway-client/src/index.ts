import { GatewayConfig, GatewayReviewRequest, GatewayReviewResponse } from '../../shared-types/src';
import { reviewDiffWithOpenAICompatibleGateway } from './openaiCompatible';

export class AIGatewayClient {
  private config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  async reviewDiff(request: GatewayReviewRequest): Promise<GatewayReviewResponse> {
    return reviewDiffWithOpenAICompatibleGateway(this.config, request);
  }
}
