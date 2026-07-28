import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/**
 * Plain-English messages for PoolPay's custom Solidity errors. The names come
 * straight from the extracted ABIs (PoolPay + PoolPayView); every one is
 * zero-argument, so no interpolation is needed. Keep this in sync with the ABIs.
 */
const ERROR_MESSAGES: Record<string, string> = {
  // Membership & pool state
  NotMember: "You're not a member of this pool.",
  PoolNotFound: "That pool doesn't exist.",
  PoolInactive: "This pool is closed.",
  NotEnded: "The pool hasn't reached the end of its term yet.",
  OutstandingLoans: "All outstanding loans must be repaid before the pool can be closed.",
  InvalidMemberCount: "A pool needs between 2 and 10 members.",
  DuplicateMember: "The same member address was added more than once.",
  EmptyName: "The pool name can't be empty.",

  // Deposits
  AlreadyDeposited: "You've already deposited for this month.",
  DepositPeriodEnded: "The deposit window for this month has closed.",

  // Borrowing
  InsufficientBalance: "The pool doesn't have enough balance to cover this.",
  ZeroAmount: "The amount must be greater than zero.",
  ZeroDuration: "The duration must be greater than zero.",
  InvalidDuration: "That repayment duration isn't allowed.",
  HasActiveDebt: "You have an outstanding loan that must be repaid first.",
  HasPendingRequests: "You have a pending loan request that must be resolved first.",

  // Voting
  InvalidRequest: "That loan request doesn't exist.",
  NotPending: "This request is no longer open for voting.",
  NotApproved: "This loan hasn't been approved.",
  AlreadyVoted: "You've already voted on this request.",
  BorrowerCannotVote: "The borrower can't vote on their own request.",
  VotingEnded: "Voting has closed for this request.",
  NotExpired: "This request hasn't expired yet.",

  // Roles
  NotBorrower: "Only the borrower can do this.",

  // Low-level / safety
  TransferFailed: "The USDC transfer failed ,check your balance and token approval.",
  ZeroAddress: "A wallet address is missing or invalid.",
  Reentrancy: "The transaction was blocked as a safety measure. Please try again.",
};

/**
 * Turn any wagmi/viem write (or read) error into a human-readable message.
 *
 * Because the ABI now includes every custom error, viem can decode the revert
 * into an error name ,this surfaces that name plus a plain-English explanation
 * instead of "Execution reverted for an unknown reason". Falls back to viem's
 * short message, then a generic line.
 */
export function decodeTxError(err: unknown): string {
  if (!err) return "";

  if (err instanceof BaseError) {
    // The user dismissed the wallet prompt.
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return "Transaction rejected in your wallet.";
    }

    // Reverted with a custom error (or a require string).
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) {
        const friendly = ERROR_MESSAGES[name];
        return friendly ? `${friendly} (${name})` : `Transaction reverted: ${name}`;
      }
      // A require(cond, "reason") string, when present.
      if (revert.reason && revert.reason !== "execution reverted") return revert.reason;
    }

    return err.shortMessage || err.message;
  }

  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

/**
 * True when an error is the chain saying "this call reverts", as opposed to the
 * RPC failing to answer at all.
 *
 * This distinction decides whether a pre-flight simulation may BLOCK a write
 * (see lib/useTx.tsx). A confirmed revert means the transaction is doomed and
 * must not be sent. A throttled or unreachable RPC means we simply don't know ,
 * and refusing a legitimate action because Arc rate-limited the dry run would
 * be worse than letting the wallet decide.
 *
 * Names rather than `instanceof`: the revert surfaces as
 * `ContractFunctionRevertedError` from `simulateContract`, but as
 * `ExecutionRevertedError` from a raw `eth_call` (verified against the revert
 * of tx 0x8d0d08ba…379a, whose chain was
 * CallExecutionError -> ExecutionRevertedError -> RpcRequestError).
 */
export function isContractRevert(err: unknown): boolean {
  let e = err as { name?: string; data?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; e && depth < 8; depth++) {
    if (e.name === "ContractFunctionRevertedError" || e.name === "ExecutionRevertedError") {
      return true;
    }
    // Revert payload present (a 4-byte custom-error selector, or longer).
    if (typeof e.data === "string" && e.data.startsWith("0x") && e.data.length >= 10) {
      return true;
    }
    e = e.cause as typeof e;
  }
  return false;
}
