export interface PayoutSplit {
  grossCents: number;
  directCostsCents: number;
  providerShareCents: number;
  platformShareCents: number;
  /** identifier stored in the ledger, e.g. 'pandit_post_cost_50_50' */
  rule: string;
}

export interface PayoutContext {
  serviceId: string;
  grossCents: number;
  /** provider flags that affect the split */
  providerFounding?: boolean;
}

export type PayoutRule = (ctx: PayoutContext) => PayoutSplit;
