"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIGatewayClient = void 0;
const openaiCompatible_1 = require("./openaiCompatible");
class AIGatewayClient {
    constructor(config) {
        this.config = config;
    }
    async reviewDiff(request) {
        return (0, openaiCompatible_1.reviewDiffWithOpenAICompatibleGateway)(this.config, request);
    }
}
exports.AIGatewayClient = AIGatewayClient;
