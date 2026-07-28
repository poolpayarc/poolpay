// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Pool, BorrowRequest, MemberStats, RequestStatus} from "./PoolPay.sol";

/**
 * @dev Minimal interface onto PoolPay's public storage getters.
 *
 *      Because `Pool`, `BorrowRequest` and `MemberStats` are all fully-static structs, the
 *      auto-generated public getters are ABI-identical to `returns (Struct memory)`, so we can
 *      declare them that way here and decode whole structs in one call.
 */
interface IPoolPay {
    function poolCount() external view returns (uint256);
    function INTEREST_RATE_BPS() external view returns (uint256);
    function pools(uint256 poolId) external view returns (Pool memory);
    function poolMemberList(uint256 poolId, uint256 index) external view returns (address);
    function memberStats(uint256 poolId, address member) external view returns (MemberStats memory);
    function hasDeposited(uint256 poolId, address member, uint256 monthNumber) external view returns (bool);
    function poolRequests(uint256 poolId, uint256 requestId) external view returns (BorrowRequest memory);
    function requestVoters(uint256 poolId, uint256 requestId, uint256 index) external view returns (address);
    function voteValue(uint256 poolId, uint256 requestId, address voter) external view returns (bool);
}

/**
 * @title PoolPayView
 * @notice Read-only companion to {PoolPay}. It holds none of the pool logic ,it only reads
 *         PoolPay's public storage and reshapes it into convenient aggregate return types for
 *         frontends. Splitting these views out keeps PoolPay under the EIP-170 bytecode limit.
 *
 * @dev Derived data that PoolPay no longer stores is reconstructed here over bounded ranges:
 *      a member's deposit history from `hasDeposited` (months 1..duration), and the pools a
 *      member belongs to by scanning `1..poolCount`. All reads are free off-chain.
 */
contract PoolPayView {
    uint256 public constant SECONDS_PER_MONTH = 30 days;

    /// @notice The PoolPay contract this view reads from.
    IPoolPay public immutable poolPay;

    error ZeroAddress();
    error PoolNotFound();
    error NotMember();
    error InvalidRequest();

    /// @notice Flat per-member view (returned by {getMembers}).
    struct MemberInfo {
        address memberAddress;
        uint256 totalDeposited;
        uint256 totalBorrowed;
        uint256 outstandingDebt;
        uint256 totalYieldEarned;
        uint256 totalYieldPaid;
        bool active;
    }

    /// @notice Detailed per-member view incl. deposit history (returned by {getMemberStats}).
    struct MemberStatsView {
        address memberAddress;
        uint256 totalDeposited;
        uint256 totalBorrowed;
        uint256 outstandingDebt;
        uint256 totalYieldEarned;
        uint256 totalYieldPaid;
        uint256[] depositHistory; // month numbers the member has deposited for
        bool active;
    }

    /// @param _poolPay Address of the deployed PoolPay contract.
    constructor(address _poolPay) {
        if (_poolPay == address(0)) revert ZeroAddress();
        poolPay = IPoolPay(_poolPay);
    }

    /// @dev Reverts if `poolId` is not a real pool.
    modifier validPool(uint256 poolId) {
        if (poolId == 0 || poolId > poolPay.poolCount()) revert PoolNotFound();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                             VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Return the core information for a pool.
    function getPool(uint256 poolId) external view validPool(poolId) returns (Pool memory) {
        return poolPay.pools(poolId);
    }

    /// @notice The fixed monthly interest rate (basis points) applied to all pools.
    /// @dev Reads the `INTEREST_RATE_BPS` constant from PoolPay (previously a per-pool field).
    function interestRateBps() external view returns (uint256) {
        return poolPay.INTEREST_RATE_BPS();
    }

    /// @notice Return the ids of every pool an address belongs to (past or present).
    function getPoolsByMember(address member) external view returns (uint256[] memory) {
        uint256 total = poolPay.poolCount();
        uint256 count;
        for (uint256 pid = 1; pid <= total; pid++) {
            if (poolPay.memberStats(pid, member).exists) count++;
        }
        uint256[] memory ids = new uint256[](count);
        uint256 j;
        for (uint256 pid = 1; pid <= total; pid++) {
            if (poolPay.memberStats(pid, member).exists) {
                ids[j++] = pid;
            }
        }
        return ids;
    }

    /// @notice Return every member of a pool together with their deposit/borrow/yield stats.
    function getMembers(uint256 poolId) external view validPool(poolId) returns (MemberInfo[] memory) {
        uint256 n = poolPay.pools(poolId).memberCount;
        MemberInfo[] memory infos = new MemberInfo[](n);
        for (uint256 i = 0; i < n; i++) {
            address m = poolPay.poolMemberList(poolId, i);
            MemberStats memory s = poolPay.memberStats(poolId, m);
            infos[i] = MemberInfo({
                memberAddress: m,
                totalDeposited: s.totalDeposited,
                totalBorrowed: s.totalBorrowed,
                outstandingDebt: s.outstandingDebt,
                totalYieldEarned: s.totalYieldEarned,
                totalYieldPaid: s.totalYieldPaid,
                active: s.active
            });
        }
        return infos;
    }

    /// @notice Return detailed stats for a single member, including their deposit history.
    function getMemberStats(uint256 poolId, address member)
        external
        view
        validPool(poolId)
        returns (MemberStatsView memory)
    {
        MemberStats memory s = poolPay.memberStats(poolId, member);
        if (!s.exists) revert NotMember();

        uint256 duration = poolPay.pools(poolId).durationInMonths;

        // Reconstruct deposit history from `hasDeposited` over the bounded month range.
        uint256 count;
        for (uint256 month = 1; month <= duration; month++) {
            if (poolPay.hasDeposited(poolId, member, month)) count++;
        }
        uint256[] memory history = new uint256[](count);
        uint256 j;
        for (uint256 month = 1; month <= duration; month++) {
            if (poolPay.hasDeposited(poolId, member, month)) {
                history[j++] = month;
            }
        }

        return MemberStatsView({
            memberAddress: member,
            totalDeposited: s.totalDeposited,
            totalBorrowed: s.totalBorrowed,
            outstandingDebt: s.outstandingDebt,
            totalYieldEarned: s.totalYieldEarned,
            totalYieldPaid: s.totalYieldPaid,
            depositHistory: history,
            active: s.active
        });
    }

    /// @notice Return all borrow requests (full invoice data, minus the off-chain `reason`).
    function getBorrowRequests(uint256 poolId) external view validPool(poolId) returns (BorrowRequest[] memory) {
        uint256 n = poolPay.pools(poolId).requestCount;
        BorrowRequest[] memory reqs = new BorrowRequest[](n);
        for (uint256 i = 0; i < n; i++) {
            reqs[i] = poolPay.poolRequests(poolId, i);
        }
        return reqs;
    }

    /// @notice Return a single borrow request.
    function getBorrowRequest(uint256 poolId, uint256 requestId)
        external
        view
        validPool(poolId)
        returns (BorrowRequest memory)
    {
        if (requestId >= poolPay.pools(poolId).requestCount) revert InvalidRequest();
        return poolPay.poolRequests(poolId, requestId);
    }

    /// @notice Return who voted on a request and how (true = yes), in vote order.
    function getVotes(uint256 poolId, uint256 requestId)
        external
        view
        validPool(poolId)
        returns (address[] memory voters, bool[] memory choices)
    {
        if (requestId >= poolPay.pools(poolId).requestCount) revert InvalidRequest();
        BorrowRequest memory r = poolPay.poolRequests(poolId, requestId);

        uint256 n = r.yesVotes + r.noVotes;
        voters = new address[](n);
        choices = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            address v = poolPay.requestVoters(poolId, requestId, i);
            voters[i] = v;
            choices[i] = poolPay.voteValue(poolId, requestId, v);
        }
    }

    /// @notice Return the pool's available balance (total deposits minus amount lent out).
    function getPoolBalance(uint256 poolId) external view validPool(poolId) returns (uint256) {
        Pool memory p = poolPay.pools(poolId);
        return p.totalDeposits - p.lentOut;
    }

    /// @notice Return the 1-based month number the pool is currently in.
    function getCurrentMonth(uint256 poolId) external view validPool(poolId) returns (uint256) {
        Pool memory p = poolPay.pools(poolId);
        if (block.timestamp <= p.startTimestamp) return 1;
        return (block.timestamp - p.startTimestamp) / SECONDS_PER_MONTH + 1;
    }
}
