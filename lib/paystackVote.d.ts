export declare const paystackRequest: (method: string, path: string, data?: any) => Promise<any>;
/** Reconcile a vote with Paystack and update the database. Returns updated vote or null. */
export declare function reconcileVoteWithPaystack(reference: string): Promise<any>;
export declare function syncPendingVotes(limit?: number): Promise<{
    checked: number;
    updated: number;
}>;
//# sourceMappingURL=paystackVote.d.ts.map