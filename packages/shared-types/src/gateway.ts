import { ReviewFinding } from './review';

export type GatewayConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  reviewTone: string;
};

export type GatewayReviewFile = {
  path: string;
  patch?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
};

export type AgentContext = {
  isAgentAuthored: boolean;
  agentName?: string;
};

export type GatewayReviewRequest = {
  diff: string;
  files: GatewayReviewFile[];
  context?: {
    repoFullName?: string;
    prNumber?: number;
    reviewTone?: string;
    agent?: AgentContext;
    customRules?: string[];
  };
};

export type GatewayReviewResponse = {
  findings: ReviewFinding[];
  rawResponse: string;
};
