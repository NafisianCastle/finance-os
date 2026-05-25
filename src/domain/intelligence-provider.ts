import type { RuleContext, SmartBuyInput, SmartBuyResult } from "./rules-engine/types";

/** MVP: DeterministicRulesProvider via evaluateSmartBuy. Post-MVP: HybridProvider(rules, ai). */
export interface IntelligenceProvider {
  evaluateSmartBuy(ctx: RuleContext, input: SmartBuyInput): Promise<SmartBuyResult>;
}
