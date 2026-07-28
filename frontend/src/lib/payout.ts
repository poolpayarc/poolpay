/* ------------------------------------------------------------------ *
 * What the contract ACTUALLY pays a member. Single source of truth.
 *
 * THE BUG THIS REPLACES
 * The UI used to compute a "net balance" as
 *
 *     totalDeposited + totalYieldEarned − totalBorrowed − totalYieldPaid
 *
 * and presented it as the payout. That is wrong in three ways at once,
 * and it under-reported badly ,a member due $500 was shown $86:
 *
 *   · `totalYieldEarned` is money the member ALREADY HAS. PoolPay pays
 *     interest out in cash the moment a loan is repaid
 *     (PoolPay.sol:507 / :526, inside `_distributeYield`), so adding it
 *     double-counts.
 *   · `totalBorrowed` is a lifetime counter, not a debt. The live debt is
 *     `outstandingDebt`, and a repaid loan's principal is already back in
 *     the pool ,so subtracting it removes money that was returned.
 *   · `totalYieldPaid` already left the member's wallet at repayment
 *     time, so subtracting it charges them for it a second time.
 *
 * WHAT THE CONTRACT DOES
 * Both exit paths transfer exactly `totalDeposited`, with no adjustment
 * for any other field:
 *
 *     closePool  PoolPay.sol:587   uint256 payout = s.totalDeposited;
 *     leavePool  PoolPay.sol:551   uint256 amountToReturn = s.totalDeposited;
 *
 * So there is one number, and this is it. Do not reintroduce a
 * "net balance" ,there is no such quantity in the contract.
 * ------------------------------------------------------------------ */

/** The fields any payout calculation needs. Structurally matches both
 *  `MemberStats` (getMemberStats) and `MemberInfo` (getMembers). */
type Payable = {
  totalDeposited: bigint;
  active: boolean;
};

/**
 * USDC the contract will transfer to this member on `closePool` or
 * `leavePool` ,their deposited principal, exactly.
 *
 * Returns 0 for a member who has already left: `closePool` skips them
 * (`if (!s.active) continue;`, PoolPay.sol:586) and their principal was
 * already returned when they left, even though their `totalDeposited`
 * counter is left standing as a historical record.
 */
export function payoutOf(s: Payable | undefined): bigint {
  if (!s || !s.active) return 0n;
  return s.totalDeposited;
}

/**
 * Whether `leavePool` would revert on liquidity right now.
 *
 * Leaving pays the full principal or nothing ,it is never partial ,but
 * it reverts with `InsufficientBalance` when too much of the pool is lent
 * out (PoolPay.sol:552). Worth telling the member before they sign.
 */
export function canCoverExit(available: bigint | undefined, payout: bigint): boolean {
  if (available === undefined) return true; // unknown: don't cry wolf
  return available >= payout;
}
