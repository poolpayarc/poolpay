// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*//////////////////////////////////////////////////////////////
                        SHARED TYPES (file-level)
//////////////////////////////////////////////////////////////*/

/// @notice Lifecycle status of a borrow request.
enum RequestStatus {
    Pending,
    Approved,
    Rejected,
    Repaid
}

/**
 * @notice Core, fully-static pool record.
 * @dev Kept free of dynamic members (`name` is a `bytes32`, not a `string`) so that the
 *      auto-generated public getter is ABI-identical to `returns (Pool memory)` and can be
 *      read directly by the companion PoolPayView contract.
 */
struct Pool {
    uint256 id;
    bytes32 name;
    address creator;
    uint256 monthlyContribution;
    uint256 durationInMonths;
    uint256 startTimestamp;
    uint256 endTimestamp;
    uint256 totalDeposits;
    uint256 lentOut;
    uint256 memberCount; // total members ever added (== poolMemberList length)
    uint256 activeMemberCount;
    uint256 requestCount;
    bool active;
}

/**
 * @notice A borrow request / on-chain invoice. Fully static; the free-text `reason` is not
 *         stored on-chain, it is emitted in the {PoolPay.BorrowRequested} event only.
 */
struct BorrowRequest {
    uint256 id;
    address borrower;
    uint256 amount;
    uint256 repaymentDurationMonths;
    uint256 totalYield;
    uint256 totalRepayment;
    uint256 dueDate;
    uint256 createdAt;
    address recipient;
    RequestStatus status;
    uint256 yesVotes;
    uint256 noVotes;
}

/// @notice Per-member accounting inside a pool (fully static).
struct MemberStats {
    uint256 totalDeposited;
    uint256 totalBorrowed;
    uint256 outstandingDebt;
    uint256 totalYieldEarned;
    uint256 totalYieldPaid;
    uint256 pendingRequests;
    bool active;
    bool exists;
}

/**
 * @title PoolPay
 * @notice Group savings & lending pool ("Mandali") for the Arc Network, denominated in USDC.
 *
 * @dev This contract holds only the state-changing logic and the raw public storage. All
 *      read/aggregation helpers live in the separate `PoolPayView` contract to keep this
 *      contract's deployed bytecode under the 24576-byte EIP-170 limit. Storage that the
 *      view needs is declared `public`; the view reconstructs derived data (deposit history,
 *      a member's pools) from it without any extra storage here.
 *
 *      Amounts are in USDC's smallest unit (6 decimals). All input validation uses custom
 *      errors (cheaper bytecode than revert strings). USDC is well-behaved, so transfer
 *      return values are checked and token-moving functions carry a non-reentrancy guard.
 */
contract PoolPay {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant MAX_MEMBERS = 10;
    uint256 public constant MIN_MEMBERS = 2;
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant SECONDS_PER_MONTH = 30 days;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Fixed monthly interest rate applied to every pool (200 bps = 2%).
    uint256 public constant INTEREST_RATE_BPS = 200;

    /*//////////////////////////////////////////////////////////////
                             CUSTOM ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error EmptyName();
    error ZeroAmount();
    error ZeroDuration();
    error InvalidDuration();
    error DuplicateMember();
    error InvalidMemberCount();
    error PoolNotFound();
    error PoolInactive();
    error NotMember();
    error Reentrancy();
    error DepositPeriodEnded();
    error AlreadyDeposited();
    error TransferFailed();
    error InsufficientBalance();
    error InvalidRequest();
    error NotPending();
    error VotingEnded();
    error NotExpired();
    error BorrowerCannotVote();
    error AlreadyVoted();
    error NotApproved();
    error NotBorrower();
    error HasActiveDebt();
    error HasPendingRequests();
    error NotEnded();
    error OutstandingLoans();

    /*//////////////////////////////////////////////////////////////
                             PUBLIC STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The USDC token used for all pool operations.
    IERC20 public immutable usdc;

    /// @notice Total pools created; also the id of the most recent pool.
    uint256 public poolCount;

    /// @notice poolId => pool record.
    mapping(uint256 => Pool) public pools;
    /// @notice poolId => index => member address (length is `pools[poolId].memberCount`).
    mapping(uint256 => address[]) public poolMemberList;
    /// @notice poolId => member => stats.
    mapping(uint256 => mapping(address => MemberStats)) public memberStats;
    /// @notice poolId => member => monthNumber => deposited?
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public hasDeposited;
    /// @notice poolId => index => borrow request (length is `pools[poolId].requestCount`).
    mapping(uint256 => BorrowRequest[]) public poolRequests;
    /// @notice poolId => requestId => index => voter (length is `yesVotes + noVotes`).
    mapping(uint256 => mapping(uint256 => address[])) public requestVoters;
    /// @notice poolId => requestId => voter => vote value (true = yes).
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public voteValue;

    // Internal-only: double-vote guard (view contract does not need it).
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) internal hasVoted;

    // Non-reentrancy guard (1 = not entered, 2 = entered).
    uint256 private _entered = 1;

    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    event PoolCreated(
        uint256 indexed poolId,
        address indexed creator,
        bytes32 name,
        uint256 monthlyContribution,
        uint256 durationInMonths
    );
    event MemberDeposited(uint256 indexed poolId, address indexed member, uint256 amount, uint256 monthNumber);
    event BorrowRequested(
        uint256 indexed poolId,
        uint256 indexed requestId,
        address indexed borrower,
        uint256 amount,
        uint256 repaymentDurationMonths,
        uint256 totalRepayment,
        uint256 dueDate,
        string reason
    );
    event VoteCast(uint256 indexed poolId, uint256 indexed requestId, address indexed voter, bool approved);
    event BorrowApproved(
        uint256 indexed poolId, uint256 indexed requestId, address indexed borrower, uint256 amount, address recipient
    );
    event BorrowRejected(uint256 indexed poolId, uint256 indexed requestId);
    event BorrowRepaid(uint256 indexed poolId, uint256 indexed requestId, address indexed borrower, uint256 totalRepayment);
    event YieldDistributed(uint256 indexed poolId, uint256 indexed requestId, address indexed member, uint256 yieldAmount);
    event MemberLeft(uint256 indexed poolId, address indexed member, uint256 amountReturned);
    event PoolClosed(uint256 indexed poolId);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier poolExists(uint256 poolId) {
        if (poolId == 0 || poolId > poolCount) revert PoolNotFound();
        _;
    }

    modifier onlyActiveMember(uint256 poolId) {
        if (!memberStats[poolId][msg.sender].active) revert NotMember();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 1) revert Reentrancy();
        _entered = 2;
        _;
        _entered = 1;
    }

    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param _usdc Address of the USDC ERC20 token used by every pool.
    constructor(address _usdc) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
    }

    /*//////////////////////////////////////////////////////////////
                             POOL CREATION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Create a new savings & lending pool.
     * @param name Pool name (bytes32; up to 31 ASCII chars).
     * @param monthlyContribution Fixed USDC amount each member deposits per month (> 0).
     * @param durationInMonths Pool lifetime, must be exactly 6 or 12.
     * @param members Additional members. The caller is always added; the caller may appear
     *        here (ignored), but no other duplicates or zero addresses are allowed.
     * @return poolId The unique, incrementing id of the new pool.
     */
    function createPool(
        bytes32 name,
        uint256 monthlyContribution,
        uint256 durationInMonths,
        address[] calldata members
    ) external returns (uint256 poolId) {
        if (name == bytes32(0)) revert EmptyName();
        if (monthlyContribution == 0) revert ZeroAmount();
        if (durationInMonths != 6 && durationInMonths != 12) revert InvalidDuration();

        poolId = ++poolCount;

        Pool storage pool = pools[poolId];
        pool.id = poolId;
        pool.name = name;
        pool.creator = msg.sender;
        pool.monthlyContribution = monthlyContribution;
        pool.durationInMonths = durationInMonths;
        pool.startTimestamp = block.timestamp;
        pool.endTimestamp = block.timestamp + (durationInMonths * SECONDS_PER_MONTH);
        pool.active = true;

        _addMember(poolId, msg.sender); // creator is always a member

        for (uint256 i = 0; i < members.length; i++) {
            address m = members[i];
            if (m == address(0)) revert ZeroAddress();
            if (m == msg.sender) continue; // creator already added
            if (memberStats[poolId][m].exists) revert DuplicateMember();
            _addMember(poolId, m);
        }

        if (pool.activeMemberCount < MIN_MEMBERS || pool.activeMemberCount > MAX_MEMBERS) {
            revert InvalidMemberCount();
        }

        emit PoolCreated(poolId, msg.sender, name, monthlyContribution, durationInMonths);
    }

    /// @dev Registers `member` as an active member of `poolId`.
    function _addMember(uint256 poolId, address member) private {
        MemberStats storage s = memberStats[poolId][member];
        s.active = true;
        s.exists = true;
        poolMemberList[poolId].push(member);
        Pool storage p = pools[poolId];
        p.memberCount += 1;
        p.activeMemberCount += 1;
    }

    /*//////////////////////////////////////////////////////////////
                                DEPOSITS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Deposit this month's fixed contribution into the pool.
     * @dev Only the current month may be deposited, once. USDC is pulled via transferFrom.
     */
    function deposit(uint256 poolId) external poolExists(poolId) onlyActiveMember(poolId) nonReentrant {
        Pool storage pool = pools[poolId];
        if (!pool.active) revert PoolInactive();

        uint256 month = _currentMonth(pool);
        if (month > pool.durationInMonths) revert DepositPeriodEnded();
        if (hasDeposited[poolId][msg.sender][month]) revert AlreadyDeposited();

        hasDeposited[poolId][msg.sender][month] = true;
        memberStats[poolId][msg.sender].totalDeposited += pool.monthlyContribution;
        pool.totalDeposits += pool.monthlyContribution;

        if (!usdc.transferFrom(msg.sender, address(this), pool.monthlyContribution)) revert TransferFailed();

        emit MemberDeposited(poolId, msg.sender, pool.monthlyContribution, month);
    }

    /*//////////////////////////////////////////////////////////////
                             BORROW REQUEST
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Create a borrow request against the pool's available balance.
     * @dev `reason` is emitted in the event only (not stored on-chain).
     * @return requestId The unique, incrementing id of the request within the pool.
     */
    function requestBorrow(
        uint256 poolId,
        uint256 amount,
        string calldata reason,
        uint256 repaymentDurationMonths,
        address recipient
    ) external poolExists(poolId) onlyActiveMember(poolId) returns (uint256 requestId) {
        Pool storage pool = pools[poolId];
        if (!pool.active) revert PoolInactive();
        if (amount == 0) revert ZeroAmount();
        if (repaymentDurationMonths == 0) revert ZeroDuration();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount > pool.totalDeposits - pool.lentOut) revert InsufficientBalance();

        requestId = pool.requestCount++;

        // Write the request field-by-field through a storage pointer, so the computed values
        // never all live on the stack at once (avoids "stack too deep").
        BorrowRequest storage nr = poolRequests[poolId].push();
        nr.id = requestId;
        nr.borrower = msg.sender;
        nr.amount = amount;
        nr.repaymentDurationMonths = repaymentDurationMonths;
        nr.totalYield = (amount * INTEREST_RATE_BPS * repaymentDurationMonths) / BPS_DENOMINATOR;
        nr.totalRepayment = amount + nr.totalYield;
        nr.dueDate = block.timestamp + (repaymentDurationMonths * SECONDS_PER_MONTH);
        nr.createdAt = block.timestamp;
        nr.recipient = recipient;
        // status defaults to Pending; yesVotes / noVotes default to 0.

        memberStats[poolId][msg.sender].pendingRequests += 1;

        // Emitted from a helper (which reads the stored request) to keep this frame shallow.
        _emitBorrowRequested(poolId, requestId, reason);
    }

    /// @dev Emits {BorrowRequested}, reading the stored request so the caller keeps few locals.
    function _emitBorrowRequested(uint256 poolId, uint256 requestId, string calldata reason) private {
        BorrowRequest storage r = poolRequests[poolId][requestId];
        emit BorrowRequested(
            poolId, requestId, r.borrower, r.amount, r.repaymentDurationMonths, r.totalRepayment, r.dueDate, reason
        );
    }

    /*//////////////////////////////////////////////////////////////
                                 VOTING
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Cast a vote on a pending borrow request.
     * @dev Every active member except the borrower may vote once. Approval (strict majority of
     *      eligible voters) immediately transfers funds to the recipient; enough NO votes reject
     *      it. Votes cannot be cast after the 7 day voting period.
     */
    function vote(uint256 poolId, uint256 requestId, bool approve)
        external
        poolExists(poolId)
        onlyActiveMember(poolId)
        nonReentrant
    {
        Pool storage pool = pools[poolId];
        if (requestId >= pool.requestCount) revert InvalidRequest();

        BorrowRequest storage req = poolRequests[poolId][requestId];
        if (req.status != RequestStatus.Pending) revert NotPending();
        if (block.timestamp > req.createdAt + VOTING_PERIOD) revert VotingEnded();
        if (msg.sender == req.borrower) revert BorrowerCannotVote();
        if (hasVoted[poolId][requestId][msg.sender]) revert AlreadyVoted();

        hasVoted[poolId][requestId][msg.sender] = true;
        voteValue[poolId][requestId][msg.sender] = approve;
        requestVoters[poolId][requestId].push(msg.sender);
        emit VoteCast(poolId, requestId, msg.sender, approve);

        // Eligible voters = active members, excluding the borrower if still active.
        uint256 eligible = pool.activeMemberCount;
        if (memberStats[poolId][req.borrower].active) eligible -= 1;
        uint256 required = eligible / 2 + 1; // strict majority

        if (approve) {
            req.yesVotes += 1;
            if (req.yesVotes >= required) _finalizeApproval(poolId, req);
        } else {
            req.noVotes += 1;
            if (eligible >= required && req.noVotes > eligible - required) _rejectRequest(poolId, req);
        }
    }

    /**
     * @notice Reject a pending request whose 7 day voting window has elapsed.
     * @dev Callable by any active member; frees the borrower to leave the pool.
     */
    function expireRequest(uint256 poolId, uint256 requestId) external poolExists(poolId) onlyActiveMember(poolId) {
        Pool storage pool = pools[poolId];
        if (requestId >= pool.requestCount) revert InvalidRequest();

        BorrowRequest storage req = poolRequests[poolId][requestId];
        if (req.status != RequestStatus.Pending) revert NotPending();
        if (block.timestamp <= req.createdAt + VOTING_PERIOD) revert NotExpired();

        _rejectRequest(poolId, req);
    }

    /// @dev Approves a request, moves principal to the recipient and updates accounting.
    function _finalizeApproval(uint256 poolId, BorrowRequest storage req) private {
        Pool storage pool = pools[poolId];
        if (pool.totalDeposits - pool.lentOut < req.amount) revert InsufficientBalance();

        req.status = RequestStatus.Approved;
        pool.lentOut += req.amount;

        MemberStats storage bs = memberStats[poolId][req.borrower];
        bs.totalBorrowed += req.amount;
        bs.outstandingDebt += req.amount;
        bs.pendingRequests -= 1;

        if (!usdc.transfer(req.recipient, req.amount)) revert TransferFailed();

        emit BorrowApproved(poolId, req.id, req.borrower, req.amount, req.recipient);
    }

    /// @dev Rejects a request and clears the borrower's pending counter.
    function _rejectRequest(uint256 poolId, BorrowRequest storage req) private {
        req.status = RequestStatus.Rejected;
        memberStats[poolId][req.borrower].pendingRequests -= 1;
        emit BorrowRejected(poolId, req.id);
    }

    /*//////////////////////////////////////////////////////////////
                               REPAYMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Repay an approved loan in full (principal + yield).
     * @dev Only the borrower may repay. Yield is distributed to net-positive lenders and the
     *      principal restores the pool's available balance.
     */
    function repay(uint256 poolId, uint256 requestId) external poolExists(poolId) nonReentrant {
        Pool storage pool = pools[poolId];
        if (requestId >= pool.requestCount) revert InvalidRequest();

        BorrowRequest storage req = poolRequests[poolId][requestId];
        if (req.status != RequestStatus.Approved) revert NotApproved();
        if (msg.sender != req.borrower) revert NotBorrower();

        if (!usdc.transferFrom(msg.sender, address(this), req.totalRepayment)) revert TransferFailed();

        req.status = RequestStatus.Repaid;
        pool.lentOut -= req.amount;
        MemberStats storage bs = memberStats[poolId][req.borrower];
        bs.outstandingDebt -= req.amount;
        bs.totalYieldPaid += req.totalYield;

        emit BorrowRepaid(poolId, requestId, req.borrower, req.totalRepayment);

        _distributeYield(poolId, req);
    }

    /**
     * @dev Distributes `req.totalYield` proportionally to active members whose net balance
     *      (totalDeposited - totalBorrowed) is positive. If none are net-positive, it is split
     *      equally among active non-borrowers so nothing is stranded. Rounding dust stays put.
     */
    function _distributeYield(uint256 poolId, BorrowRequest storage req) private {
        uint256 totalYield = req.totalYield;
        if (totalYield == 0) return;

        address[] storage list = poolMemberList[poolId];
        uint256 len = list.length;

        uint256 totalPositive;
        for (uint256 i = 0; i < len; i++) {
            MemberStats storage s = memberStats[poolId][list[i]];
            if (s.active && s.totalDeposited > s.totalBorrowed) {
                totalPositive += (s.totalDeposited - s.totalBorrowed);
            }
        }

        if (totalPositive > 0) {
            for (uint256 i = 0; i < len; i++) {
                address m = list[i];
                MemberStats storage s = memberStats[poolId][m];
                if (s.active && s.totalDeposited > s.totalBorrowed) {
                    uint256 share = (totalYield * (s.totalDeposited - s.totalBorrowed)) / totalPositive;
                    if (share > 0) {
                        s.totalYieldEarned += share;
                        if (!usdc.transfer(m, share)) revert TransferFailed();
                        emit YieldDistributed(poolId, req.id, m, share);
                    }
                }
            }
        } else {
            uint256 eligibleCount;
            for (uint256 i = 0; i < len; i++) {
                MemberStats storage s = memberStats[poolId][list[i]];
                if (s.active && list[i] != req.borrower) eligibleCount += 1;
            }
            if (eligibleCount > 0) {
                uint256 share = totalYield / eligibleCount;
                if (share > 0) {
                    for (uint256 i = 0; i < len; i++) {
                        address m = list[i];
                        MemberStats storage s = memberStats[poolId][m];
                        if (s.active && m != req.borrower) {
                            s.totalYieldEarned += share;
                            if (!usdc.transfer(m, share)) revert TransferFailed();
                            emit YieldDistributed(poolId, req.id, m, share);
                        }
                    }
                }
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                               LEAVE POOL
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Leave the pool and withdraw your remaining principal (`totalDeposited`).
     * @dev Requires no outstanding loans and no pending requests, and enough pool liquidity.
     */
    function leavePool(uint256 poolId) external poolExists(poolId) onlyActiveMember(poolId) nonReentrant {
        Pool storage pool = pools[poolId];
        if (!pool.active) revert PoolInactive();

        MemberStats storage s = memberStats[poolId][msg.sender];
        if (s.outstandingDebt != 0) revert HasActiveDebt();
        if (s.pendingRequests != 0) revert HasPendingRequests();

        uint256 amountToReturn = s.totalDeposited;
        if (pool.totalDeposits - pool.lentOut < amountToReturn) revert InsufficientBalance();

        s.active = false;
        pool.activeMemberCount -= 1;
        pool.totalDeposits -= amountToReturn;

        if (amountToReturn > 0) {
            if (!usdc.transfer(msg.sender, amountToReturn)) revert TransferFailed();
        }

        emit MemberLeft(poolId, msg.sender, amountToReturn);
    }

    /*//////////////////////////////////////////////////////////////
                           YEAR END / CLOSE
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Close a matured pool and pay out every remaining member their `totalDeposited`.
     * @dev Callable by any active member after `endTimestamp`; all loans must be repaid first.
     */
    function closePool(uint256 poolId) external poolExists(poolId) onlyActiveMember(poolId) nonReentrant {
        Pool storage pool = pools[poolId];
        if (!pool.active) revert PoolInactive();
        if (block.timestamp < pool.endTimestamp) revert NotEnded();
        if (pool.lentOut != 0) revert OutstandingLoans();

        pool.active = false;

        address[] storage list = poolMemberList[poolId];
        uint256 len = list.length;
        for (uint256 i = 0; i < len; i++) {
            address m = list[i];
            MemberStats storage s = memberStats[poolId][m];
            if (!s.active) continue;
            uint256 payout = s.totalDeposited;
            s.active = false;
            pool.activeMemberCount -= 1;
            if (payout > 0) {
                pool.totalDeposits -= payout;
                if (!usdc.transfer(m, payout)) revert TransferFailed();
            }
        }

        emit PoolClosed(poolId);
    }

    /*//////////////////////////////////////////////////////////////
                            INTERNAL HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev 1-based current month for a pool derived from `block.timestamp`.
    function _currentMonth(Pool storage pool) private view returns (uint256) {
        if (block.timestamp <= pool.startTimestamp) return 1;
        return (block.timestamp - pool.startTimestamp) / SECONDS_PER_MONTH + 1;
    }
}
