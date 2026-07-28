// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PoolPay, Pool, BorrowRequest, RequestStatus} from "../src/PoolPay.sol";
import {PoolPayView} from "../src/PoolPayView.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/**
 * @title PoolPayTest
 * @notice End-to-end tests simulating a real 4-member mandali (alice, bob, charlie, dave),
 *         with the interest rate fixed at 2%/month (200 bps).
 *
 * @dev Foundry runs `setUp()` before every test, so each test starts from a fresh pool
 *      (poolId 1) with all four members funded and approved. Helpers assemble the
 *      preconditions each test needs (deposits, a pending borrow, an approved borrow).
 *
 *      Note on amounts: one month of contributions is 4 * 100 = 400 USDC, so the headline
 *      700 USDC borrow requires two months of deposits (800 USDC available). Tests that
 *      exercise the borrow flow therefore deposit for two months first.
 */
contract PoolPayTest is Test {
    // Events re-declared locally so they can be used with vm.expectEmit.
    event PoolCreated(
        uint256 indexed poolId,
        address indexed creator,
        bytes32 name,
        uint256 monthlyContribution,
        uint256 durationInMonths
    );
    event BorrowApproved(
        uint256 indexed poolId, uint256 indexed requestId, address indexed borrower, uint256 amount, address recipient
    );
    event MemberLeft(uint256 indexed poolId, address indexed member, uint256 amountReturned);
    event PoolClosed(uint256 indexed poolId);

    MockUSDC internal usdc;
    PoolPay internal poolPay;
    PoolPayView internal viewer;

    address internal alice;
    address internal bob;
    address internal charlie;
    address internal dave;

    uint256 internal poolId;

    uint256 internal constant MONTHLY = 100e6; // 100 USDC / month
    uint256 internal constant INITIAL_MINT = 10000e6; // 10,000 USDC per user
    uint256 internal constant START_TIME = 1_700_000_000; // fixed base timestamp
    uint256 internal constant MONTH = 30 days;

    function setUp() public {
        vm.warp(START_TIME);

        usdc = new MockUSDC();
        poolPay = new PoolPay(address(usdc));
        viewer = new PoolPayView(address(poolPay));

        alice = vm.addr(1);
        bob = vm.addr(2);
        charlie = vm.addr(3);
        dave = vm.addr(4);
        vm.label(alice, "alice");
        vm.label(bob, "bob");
        vm.label(charlie, "charlie");
        vm.label(dave, "dave");

        address[4] memory users = [alice, bob, charlie, dave];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], INITIAL_MINT);
            vm.prank(users[i]);
            usdc.approve(address(poolPay), type(uint256).max);
        }

        // Alice creates the pool (poolId == 1). The members array includes alice; she is the
        // creator and is added automatically, so the duplicate entry is simply ignored.
        address[] memory members = new address[](4);
        members[0] = alice;
        members[1] = bob;
        members[2] = charlie;
        members[3] = dave;
        vm.prank(alice);
        poolId = poolPay.createPool(bytes32("boys mandali"), MONTHLY, 12, members);
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev All four members deposit for the current month.
    function _allDeposit() internal {
        vm.prank(alice);
        poolPay.deposit(poolId);
        vm.prank(bob);
        poolPay.deposit(poolId);
        vm.prank(charlie);
        poolPay.deposit(poolId);
        vm.prank(dave);
        poolPay.deposit(poolId);
    }

    /// @dev Deposit two full months (800 USDC total available); ends in month 2.
    function _depositTwoMonths() internal {
        _allDeposit(); // month 1
        vm.warp(block.timestamp + MONTH); // advance into month 2
        _allDeposit(); // month 2
    }

    /// @dev Two months of deposits, then bob requests a 700 USDC / 3-month borrow.
    function _setupPendingBorrow() internal returns (uint256 reqId) {
        _depositTwoMonths();
        vm.prank(bob);
        reqId = poolPay.requestBorrow(poolId, 700e6, "medical bills", 3, bob);
    }

    /// @dev A pending borrow that alice + charlie approve (2 of 3 eligible => majority).
    function _setupApprovedBorrow() internal returns (uint256 reqId) {
        reqId = _setupPendingBorrow();
        vm.prank(alice);
        poolPay.vote(poolId, reqId, true);
        vm.prank(charlie);
        poolPay.vote(poolId, reqId, true);
    }

    /*//////////////////////////////////////////////////////////////
                          TEST 1 ,CREATE POOL
    //////////////////////////////////////////////////////////////*/

    function test_CreatePool_Success() public view {
        Pool memory p = viewer.getPool(poolId);
        assertEq(p.id, 1);
        assertEq(p.name, bytes32("boys mandali"));
        assertEq(p.creator, alice);
        assertEq(p.monthlyContribution, MONTHLY);
        assertEq(p.durationInMonths, 12);
        assertEq(p.memberCount, 4);
        assertEq(p.activeMemberCount, 4);
        assertTrue(p.active);
        assertEq(p.startTimestamp, START_TIME);
        assertEq(p.endTimestamp, START_TIME + 12 * MONTH);
        assertEq(p.totalDeposits, 0);
        assertEq(p.lentOut, 0);
        assertEq(p.requestCount, 0);

        // Members present and in insertion order [alice, bob, charlie, dave].
        PoolPayView.MemberInfo[] memory m = viewer.getMembers(poolId);
        assertEq(m.length, 4);
        assertEq(m[0].memberAddress, alice);
        assertEq(m[1].memberAddress, bob);
        assertEq(m[2].memberAddress, charlie);
        assertEq(m[3].memberAddress, dave);
        assertTrue(m[0].active);

        // Membership index.
        uint256[] memory alicePools = viewer.getPoolsByMember(alice);
        assertEq(alicePools.length, 1);
        assertEq(alicePools[0], 1);

        // Interest rate is fixed at 2%.
        assertEq(viewer.interestRateBps(), 200);
        assertEq(poolPay.INTEREST_RATE_BPS(), 200);
    }

    function test_CreatePool_EmitsEvent() public {
        address[] memory members = new address[](2);
        members[0] = bob;
        members[1] = charlie;

        vm.expectEmit(true, true, false, true);
        emit PoolCreated(2, alice, bytes32("second"), MONTHLY, 6);

        vm.prank(alice);
        uint256 id = poolPay.createPool(bytes32("second"), MONTHLY, 6, members);
        assertEq(id, 2);
    }

    function test_CreatePool_RevertTooFewMembers() public {
        address[] memory members = new address[](0); // only the creator => 1 member
        vm.prank(alice);
        vm.expectRevert(PoolPay.InvalidMemberCount.selector);
        poolPay.createPool(bytes32("solo"), MONTHLY, 12, members);
    }

    function test_CreatePool_RevertTooManyMembers() public {
        address[] memory members = new address[](11); // creator + 11 = 12 > MAX_MEMBERS(10)
        for (uint256 i = 0; i < 11; i++) {
            members[i] = vm.addr(100 + i); // distinct, none equal to alice
        }
        vm.prank(alice);
        vm.expectRevert(PoolPay.InvalidMemberCount.selector);
        poolPay.createPool(bytes32("crowd"), MONTHLY, 12, members);
    }

    function test_CreatePool_RevertInvalidDuration() public {
        address[] memory members = new address[](1);
        members[0] = bob;
        vm.prank(alice);
        vm.expectRevert(PoolPay.InvalidDuration.selector);
        poolPay.createPool(bytes32("baddur"), MONTHLY, 5, members);
    }

    function test_CreatePool_RevertEmptyName() public {
        address[] memory members = new address[](1);
        members[0] = bob;
        vm.prank(alice);
        vm.expectRevert(PoolPay.EmptyName.selector);
        poolPay.createPool(bytes32(0), MONTHLY, 12, members);
    }

    function test_CreatePool_RevertZeroContribution() public {
        address[] memory members = new address[](1);
        members[0] = bob;
        vm.prank(alice);
        vm.expectRevert(PoolPay.ZeroAmount.selector);
        poolPay.createPool(bytes32("zero"), 0, 12, members);
    }

    function test_CreatePool_RevertDuplicateMember() public {
        address[] memory members = new address[](2);
        members[0] = bob;
        members[1] = bob;
        vm.prank(alice);
        vm.expectRevert(PoolPay.DuplicateMember.selector);
        poolPay.createPool(bytes32("dup"), MONTHLY, 12, members);
    }

    /*//////////////////////////////////////////////////////////////
                            TEST 2 ,DEPOSIT
    //////////////////////////////////////////////////////////////*/

    function test_Deposit_Success() public {
        _allDeposit();

        assertEq(viewer.getPoolBalance(poolId), 400e6);
        assertEq(viewer.getPool(poolId).totalDeposits, 400e6);
        assertEq(viewer.getCurrentMonth(poolId), 1);
        assertEq(usdc.balanceOf(address(poolPay)), 400e6);
        assertEq(usdc.balanceOf(alice), INITIAL_MINT - MONTHLY); // 9,900

        PoolPayView.MemberStatsView memory s = viewer.getMemberStats(poolId, alice);
        assertEq(s.totalDeposited, 100e6);
        assertEq(s.depositHistory.length, 1);
        assertEq(s.depositHistory[0], 1);
    }

    function test_Deposit_RevertDoubleDeposit() public {
        vm.prank(bob);
        poolPay.deposit(poolId);

        vm.prank(bob);
        vm.expectRevert(PoolPay.AlreadyDeposited.selector);
        poolPay.deposit(poolId);
    }

    function test_Deposit_RevertNotMember() public {
        address random = vm.addr(99);
        usdc.mint(random, 1000e6);
        vm.prank(random);
        usdc.approve(address(poolPay), type(uint256).max);

        vm.prank(random);
        vm.expectRevert(PoolPay.NotMember.selector);
        poolPay.deposit(poolId);
    }

    function test_Deposit_RevertAfterDurationEnds() public {
        vm.warp(START_TIME + 12 * MONTH + 1); // month 13 > 12
        vm.prank(alice);
        vm.expectRevert(PoolPay.DepositPeriodEnded.selector);
        poolPay.deposit(poolId);
    }

    /*//////////////////////////////////////////////////////////////
                          TEST 3 ,REQUEST BORROW
    //////////////////////////////////////////////////////////////*/

    function test_RequestBorrow_Success() public {
        _depositTwoMonths(); // 800 available, currently in month 2
        uint256 nowTs = block.timestamp;

        vm.prank(bob);
        uint256 reqId = poolPay.requestBorrow(poolId, 700e6, "medical bills", 3, bob);
        assertEq(reqId, 0);

        BorrowRequest memory r = viewer.getBorrowRequest(poolId, reqId);
        assertEq(r.id, 0);
        assertEq(r.borrower, bob);
        assertEq(r.amount, 700e6);
        assertEq(r.repaymentDurationMonths, 3);
        assertEq(r.totalYield, 42e6); // 700e6 * 200 * 3 / 10000
        assertEq(r.totalRepayment, 742e6); // 700 + 42
        assertEq(r.dueDate, nowTs + 3 * MONTH); // ~90 days out
        assertEq(r.recipient, bob);
        assertEq(uint256(r.status), uint256(RequestStatus.Pending));
        assertEq(r.yesVotes, 0);
        assertEq(r.noVotes, 0);

        assertEq(viewer.getPool(poolId).requestCount, 1);
    }

    function test_RequestBorrow_RevertExceedsAvailable() public {
        _allDeposit(); // only 400 available
        vm.prank(bob);
        vm.expectRevert(PoolPay.InsufficientBalance.selector);
        poolPay.requestBorrow(poolId, 700e6, "too much", 3, bob);
    }

    function test_RequestBorrow_RevertZeroAmount() public {
        _allDeposit();
        vm.prank(bob);
        vm.expectRevert(PoolPay.ZeroAmount.selector);
        poolPay.requestBorrow(poolId, 0, "nothing", 3, bob);
    }

    function test_RequestBorrow_RevertNonMember() public {
        _allDeposit();
        address random = vm.addr(99);
        vm.prank(random);
        vm.expectRevert(PoolPay.NotMember.selector);
        poolPay.requestBorrow(poolId, 100e6, "x", 3, random);
    }

    /*//////////////////////////////////////////////////////////////
                             TEST 4 ,VOTE
    //////////////////////////////////////////////////////////////*/

    function test_Vote_Success() public {
        uint256 reqId = _setupPendingBorrow(); // 800 deposited, bob requested 700
        uint256 bobBefore = usdc.balanceOf(bob);
        assertEq(viewer.getPoolBalance(poolId), 800e6);

        // 1st YES: eligible = 3, required = 2, so not yet approved.
        vm.prank(alice);
        poolPay.vote(poolId, reqId, true);
        assertEq(uint256(viewer.getBorrowRequest(poolId, reqId).status), uint256(RequestStatus.Pending));

        // 2nd YES reaches the majority and auto-approves + disburses.
        vm.expectEmit(true, true, true, true);
        emit BorrowApproved(poolId, reqId, bob, 700e6, bob);
        vm.prank(charlie);
        poolPay.vote(poolId, reqId, true);

        BorrowRequest memory r = viewer.getBorrowRequest(poolId, reqId);
        assertEq(uint256(r.status), uint256(RequestStatus.Approved));
        assertEq(r.yesVotes, 2);
        assertEq(r.noVotes, 0);

        // 700 USDC went to bob; available fell 800 -> 100.
        assertEq(usdc.balanceOf(bob), bobBefore + 700e6);
        assertEq(viewer.getPoolBalance(poolId), 100e6);
        assertEq(viewer.getPool(poolId).lentOut, 700e6);
        assertEq(viewer.getMemberStats(poolId, bob).outstandingDebt, 700e6);

        // Votes recorded.
        (address[] memory voters, bool[] memory choices) = viewer.getVotes(poolId, reqId);
        assertEq(voters.length, 2);
        assertEq(voters[0], alice);
        assertEq(voters[1], charlie);
        assertTrue(choices[0]);
        assertTrue(choices[1]);
    }

    function test_Vote_RevertBorrowerVotesOwn() public {
        uint256 reqId = _setupPendingBorrow();
        vm.prank(bob);
        vm.expectRevert(PoolPay.BorrowerCannotVote.selector);
        poolPay.vote(poolId, reqId, true);
    }

    function test_Vote_RevertDoubleVote() public {
        uint256 reqId = _setupPendingBorrow();
        vm.prank(alice);
        poolPay.vote(poolId, reqId, true); // 1 of 2 needed -> still pending

        vm.prank(alice);
        vm.expectRevert(PoolPay.AlreadyVoted.selector);
        poolPay.vote(poolId, reqId, true);
    }

    function test_Vote_RevertNonMember() public {
        uint256 reqId = _setupPendingBorrow();
        vm.prank(vm.addr(99));
        vm.expectRevert(PoolPay.NotMember.selector);
        poolPay.vote(poolId, reqId, true);
    }

    function test_Vote_RejectedByNoVotes() public {
        uint256 reqId = _setupPendingBorrow(); // eligible 3, reject once no > 1 (i.e. 2 NO)
        vm.prank(alice);
        poolPay.vote(poolId, reqId, false);
        assertEq(uint256(viewer.getBorrowRequest(poolId, reqId).status), uint256(RequestStatus.Pending));

        vm.prank(charlie);
        poolPay.vote(poolId, reqId, false);
        assertEq(uint256(viewer.getBorrowRequest(poolId, reqId).status), uint256(RequestStatus.Rejected));

        // No funds moved; balance intact.
        assertEq(viewer.getPoolBalance(poolId), 800e6);
    }

    function test_Vote_RevertAfterExpiry() public {
        uint256 reqId = _setupPendingBorrow();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        vm.expectRevert(PoolPay.VotingEnded.selector);
        poolPay.vote(poolId, reqId, true);
    }

    function test_ExpireRequest_Success() public {
        uint256 reqId = _setupPendingBorrow();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        poolPay.expireRequest(poolId, reqId);
        assertEq(uint256(viewer.getBorrowRequest(poolId, reqId).status), uint256(RequestStatus.Rejected));
    }

    function test_ExpireRequest_RevertNotExpired() public {
        uint256 reqId = _setupPendingBorrow();
        vm.prank(alice);
        vm.expectRevert(PoolPay.NotExpired.selector);
        poolPay.expireRequest(poolId, reqId);
    }

    /*//////////////////////////////////////////////////////////////
                            TEST 5 ,REPAY
    //////////////////////////////////////////////////////////////*/

    function test_Repay_Success() public {
        uint256 reqId = _setupApprovedBorrow(); // bob borrowed 700, owes 742

        // bob already holds enough to repay: 9,800 (after 2 months of deposits) + 700 borrowed.
        // (No extra minting needed ,he starts with 10,000 USDC.)
        assertEq(usdc.balanceOf(bob), 10500e6);

        vm.prank(bob);
        poolPay.repay(poolId, reqId);

        // Request settled.
        assertEq(uint256(viewer.getBorrowRequest(poolId, reqId).status), uint256(RequestStatus.Repaid));

        // Principal restored, debt cleared.
        assertEq(viewer.getPool(poolId).lentOut, 0);
        assertEq(viewer.getPoolBalance(poolId), 800e6);
        assertEq(viewer.getMemberStats(poolId, bob).outstandingDebt, 0);
        assertEq(viewer.getMemberStats(poolId, bob).totalYieldPaid, 42e6);

        // 42 USDC yield split among the 3 net-positive lenders => 14 each.
        assertEq(viewer.getMemberStats(poolId, alice).totalYieldEarned, 14e6);
        assertEq(viewer.getMemberStats(poolId, charlie).totalYieldEarned, 14e6);
        assertEq(viewer.getMemberStats(poolId, dave).totalYieldEarned, 14e6);
        assertEq(viewer.getMemberStats(poolId, bob).totalYieldEarned, 0);

        // Concrete balances after repayment.
        assertEq(usdc.balanceOf(bob), 10500e6 - 742e6); // 9,758
        assertEq(usdc.balanceOf(alice), 9800e6 + 14e6); // 9,814
        assertEq(usdc.balanceOf(charlie), 9814e6);
        assertEq(usdc.balanceOf(dave), 9814e6);
        // Contract holds exactly the 800 principal again (yield fully distributed).
        assertEq(usdc.balanceOf(address(poolPay)), 800e6);
    }

    function test_Repay_RevertNotBorrower() public {
        uint256 reqId = _setupApprovedBorrow();
        vm.prank(alice);
        vm.expectRevert(PoolPay.NotBorrower.selector);
        poolPay.repay(poolId, reqId);
    }

    function test_Repay_RevertNotApproved() public {
        uint256 reqId = _setupPendingBorrow(); // still pending
        vm.prank(bob);
        vm.expectRevert(PoolPay.NotApproved.selector);
        poolPay.repay(poolId, reqId);
    }

    /*//////////////////////////////////////////////////////////////
                          TEST 6 ,LEAVE POOL
    //////////////////////////////////////////////////////////////*/

    function test_LeavePool_Success() public {
        _allDeposit(); // alice has deposited 100
        uint256 aliceBefore = usdc.balanceOf(alice); // 9,900

        vm.expectEmit(true, true, false, true);
        emit MemberLeft(poolId, alice, 100e6);
        vm.prank(alice);
        poolPay.leavePool(poolId);

        assertEq(usdc.balanceOf(alice), aliceBefore + 100e6); // back to 10,000
        Pool memory p = viewer.getPool(poolId);
        assertEq(p.activeMemberCount, 3);
        assertEq(p.totalDeposits, 300e6);
        assertEq(viewer.getPoolBalance(poolId), 300e6);
        assertFalse(viewer.getMemberStats(poolId, alice).active);
    }

    function test_LeavePool_RevertActiveDebt() public {
        _setupApprovedBorrow(); // bob owes 700
        vm.prank(bob);
        vm.expectRevert(PoolPay.HasActiveDebt.selector);
        poolPay.leavePool(poolId);
    }

    function test_LeavePool_RevertPendingRequest() public {
        _setupPendingBorrow(); // bob has a pending request
        vm.prank(bob);
        vm.expectRevert(PoolPay.HasPendingRequests.selector);
        poolPay.leavePool(poolId);
    }

    /*//////////////////////////////////////////////////////////////
                          TEST 7 ,CLOSE POOL
    //////////////////////////////////////////////////////////////*/

    function test_ClosePool_Success() public {
        uint256 reqId = _setupApprovedBorrow();
        vm.prank(bob);
        poolPay.repay(poolId, reqId); // everything settled, lentOut == 0

        vm.warp(START_TIME + 12 * MONTH + 1); // past maturity

        vm.expectEmit(true, false, false, false);
        emit PoolClosed(poolId);
        vm.prank(alice);
        poolPay.closePool(poolId);

        // Each member is paid back their 200 principal (yield was already distributed).
        assertEq(usdc.balanceOf(alice), 9814e6 + 200e6); // 10,014
        assertEq(usdc.balanceOf(bob), 9758e6 + 200e6); // 9,958
        assertEq(usdc.balanceOf(charlie), 9814e6 + 200e6); // 10,014
        assertEq(usdc.balanceOf(dave), 9814e6 + 200e6); // 10,014
        assertEq(usdc.balanceOf(address(poolPay)), 0);

        assertFalse(viewer.getPool(poolId).active);
    }

    function test_ClosePool_RevertNotEnded() public {
        _allDeposit();
        vm.prank(alice);
        vm.expectRevert(PoolPay.NotEnded.selector);
        poolPay.closePool(poolId);
    }

    function test_ClosePool_RevertOutstandingLoans() public {
        _setupApprovedBorrow(); // bob owes 700, not repaid
        vm.warp(START_TIME + 12 * MONTH + 1);
        vm.prank(alice);
        vm.expectRevert(PoolPay.OutstandingLoans.selector);
        poolPay.closePool(poolId);
    }

    /*//////////////////////////////////////////////////////////////
                           CONSTRUCTOR GUARDS
    //////////////////////////////////////////////////////////////*/

    function test_Constructor_RevertZeroUSDC() public {
        vm.expectRevert(PoolPay.ZeroAddress.selector);
        new PoolPay(address(0));
    }

    function test_ViewConstructor_RevertZeroPoolPay() public {
        vm.expectRevert(PoolPayView.ZeroAddress.selector);
        new PoolPayView(address(0));
    }
}
