import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

const { ethers } = hre;

describe("StakingReward", function () {
    async function deployFixture() {
        const [owner, user, other] = await ethers.getSigners();
        // Define the ABI for the function
        const abi = ["function deposit()"];

        // Create an interface from the ABI
        const iface = new ethers.Interface(abi);

        // Encode the calldata for deposit(uint256)
        const amount = ethers.parseUnits("1", 18); // example: 1 token with 18 decimals
        const calldata = iface.encodeFunctionData("deposit");

        console.log("Calldata:", calldata);
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const stakingToken = await MockERC20.deploy("Staking Token", "STK", 0);
        await stakingToken.waitForDeployment();

        const rewardToken = await MockERC20.deploy("Reward Token", "RWD", 0);
        await rewardToken.waitForDeployment();

        const rewardsDuration = 1000n; // seconds

        const StakingReward = await ethers.getContractFactory("StakingReward");
        const stakingContract = await StakingReward.deploy(
            await owner.getAddress(),
            await stakingToken.getAddress(),
            await rewardToken.getAddress(),
            rewardsDuration
        );
        await stakingContract.waitForDeployment();

        const initialMint = ethers.parseEther("100000");
        await (stakingToken as any).mint(await user.getAddress(), initialMint);
        await (stakingToken as any).mint(await other.getAddress(), initialMint);
        // Fund owner with rewards for notify
        await (rewardToken as any).mint(await owner.getAddress(), initialMint);

        return { owner, user, other, stakingToken, rewardToken, stakingContract, initialMint, rewardsDuration };
    }

    describe("constructor / roles", function () {
        it("sets tokens, duration and grants roles to admin", async function () {
            const { owner, stakingToken, rewardToken, stakingContract, rewardsDuration } = await loadFixture(deployFixture);
            expect(await stakingContract.stakingToken()).to.equal(await stakingToken.getAddress());
            expect(await stakingContract.rewardsToken()).to.equal(await rewardToken.getAddress());
            expect(await stakingContract.rewardsDuration()).to.equal(rewardsDuration);

            const admin = await owner.getAddress();
            const REWARDS_MANAGER_ROLE = await stakingContract.REWARDS_MANAGER_ROLE();
            const PAUSER_ROLE = await stakingContract.PAUSER_ROLE();
            const GUARDIAN_ROLE = await stakingContract.GUARDIAN_ROLE();

            expect(await stakingContract.hasRole(REWARDS_MANAGER_ROLE, admin)).to.equal(true);
            expect(await stakingContract.hasRole(PAUSER_ROLE, admin)).to.equal(true);
            expect(await stakingContract.hasRole(GUARDIAN_ROLE, admin)).to.equal(true);
        });
    });

    describe("views (initial state)", function () {
        it("has zero rewardPerToken and earned", async function () {
            const { user, stakingContract } = await loadFixture(deployFixture);
            expect(await stakingContract.rewardPerToken()).to.equal(0n);
            expect(await stakingContract.earned(await user.getAddress())).to.equal(0n);
        });

        it("lastTimeRewardApplicable is 0 initially", async function () {
            const { stakingContract } = await loadFixture(deployFixture);
            expect(await stakingContract.lastTimeRewardApplicable()).to.equal(0n);
        });
    });

    describe("stake", function () {
        it("reverts on zero amount", async function () {
            const { user, stakingContract } = await loadFixture(deployFixture);
            await expect(stakingContract.connect(user).stake(0n)).to.be.revertedWith("amount=0");
        });

        it("transfers tokens, updates totalSupply, and emits event", async function () {
            const { user, stakingToken, stakingContract } = await loadFixture(deployFixture);
            const amount = ethers.parseEther("100");

            await (stakingToken as any).connect(user).approve(await stakingContract.getAddress(), amount);

            const userBefore = await (stakingToken as any).balanceOf(await user.getAddress());
            const contractBefore = await (stakingToken as any).balanceOf(await stakingContract.getAddress());
            const totalBefore = await stakingContract.totalSupply();

            await expect(stakingContract.connect(user).stake(amount))
                .to.emit(stakingContract, "Staked")
                .withArgs(await user.getAddress(), amount);

            const userAfter = await (stakingToken as any).balanceOf(await user.getAddress());
            const contractAfter = await (stakingToken as any).balanceOf(await stakingContract.getAddress());
            const totalAfter = await stakingContract.totalSupply();

            expect(userAfter).to.equal(userBefore - amount);
            expect(contractAfter).to.equal(contractBefore + amount);
            expect(totalAfter).to.equal(totalBefore + amount);
        });
    });

    describe("withdraw", function () {
        it("reverts on zero amount", async function () {
            const { user, stakingContract } = await loadFixture(deployFixture);
            await expect(stakingContract.connect(user).withdraw(0n)).to.be.revertedWith("amount=0");
        });

        it("reverts when withdrawing more than staked", async function () {
            const { user, stakingToken, stakingContract } = await loadFixture(deployFixture);
            const amount = ethers.parseEther("10");
            await (stakingToken as any).connect(user).approve(await stakingContract.getAddress(), amount);
            await stakingContract.connect(user).stake(amount);

            await expect(stakingContract.connect(user).withdraw(amount + 1n)).to.be.reverted;
        });

        it("transfers tokens back, updates totalSupply, and emits event", async function () {
            const { user, stakingToken, stakingContract } = await loadFixture(deployFixture);
            const amount = ethers.parseEther("50");
            await (stakingToken as any).connect(user).approve(await stakingContract.getAddress(), amount);
            await stakingContract.connect(user).stake(amount);

            const userBefore = await (stakingToken as any).balanceOf(await user.getAddress());
            const contractBefore = await (stakingToken as any).balanceOf(await stakingContract.getAddress());
            const totalBefore = await stakingContract.totalSupply();

            await expect(stakingContract.connect(user).withdraw(amount))
                .to.emit(stakingContract, "Withdrawn")
                .withArgs(await user.getAddress(), amount);

            const userAfter = await (stakingToken as any).balanceOf(await user.getAddress());
            const contractAfter = await (stakingToken as any).balanceOf(await stakingContract.getAddress());
            const totalAfter = await stakingContract.totalSupply();

            expect(userAfter).to.equal(userBefore + amount);
            expect(contractAfter).to.equal(contractBefore - amount);
            expect(totalAfter).to.equal(totalBefore - amount);
        });
    });

    describe("rewards emission", function () {
        it("accrues rewards over time after notify", async function () {
            const { owner, user, stakingToken, rewardToken, stakingContract, rewardsDuration } = await loadFixture(deployFixture);

            const stakeAmount = ethers.parseEther("1000");
            await (stakingToken as any).connect(user).approve(await stakingContract.getAddress(), stakeAmount);
            await stakingContract.connect(user).stake(stakeAmount);

            const notifyAmount = ethers.parseEther("1000");
            await (rewardToken as any).connect(owner).approve(await stakingContract.getAddress(), notifyAmount);
            await stakingContract.connect(owner).notifyRewardAmount(notifyAmount);

            // rewardRate = 1000 / rewardsDuration => with rewardsDuration=1000 => 1 token/sec
            await time.increase(100);

            const rewardRate = await stakingContract.rewardRate();
            const expectedMin = rewardRate * 100n; // at least 100 seconds accrued
            const expectedMax = rewardRate * 102n; // allow up to +2s drift between view/tx blocks

            // sanity: earned() is within range too
            const viewEarned = await stakingContract.earned(await user.getAddress());
            expect(viewEarned).to.be.gte(expectedMin);
            expect(viewEarned).to.be.lte(expectedMax);

            // Claim and check delta within bounds
            const before = await (rewardToken as any).balanceOf(await user.getAddress());
            await expect(stakingContract.connect(user).getReward()).to.emit(stakingContract, "RewardPaid");
            const after = await (rewardToken as any).balanceOf(await user.getAddress());
            const paid = after - before;
            expect(paid).to.be.gte(expectedMin);
            expect(paid).to.be.lte(expectedMax);
        });

        it("adds leftover when notifying during ongoing period", async function () {
            const { owner, user, stakingToken, rewardToken, stakingContract, rewardsDuration } = await loadFixture(deployFixture);

            const stakeAmount = ethers.parseEther("1000");
            await (stakingToken as any).connect(user).approve(await stakingContract.getAddress(), stakeAmount);
            await stakingContract.connect(user).stake(stakeAmount);

            const amount1 = ethers.parseEther("1000");
            await (rewardToken as any).connect(owner).approve(await stakingContract.getAddress(), amount1);
            await stakingContract.connect(owner).notifyRewardAmount(amount1);

            await time.increase(400);

            const amount2 = ethers.parseEther("500");
            await (rewardToken as any).connect(owner).approve(await stakingContract.getAddress(), amount2);
            await stakingContract.connect(owner).notifyRewardAmount(amount2);

            const prevRate = ethers.parseEther("1"); // from first notify
            // allow up to 3 seconds drift between blocks
            const leftoverMax = (rewardsDuration - 400n) * prevRate; // ideal leftover
            const leftoverMin = (rewardsDuration - 403n) * prevRate; // with 3s drift
            const expectedRateMax = (amount2 + leftoverMax) / rewardsDuration;
            const expectedRateMin = (amount2 + leftoverMin) / rewardsDuration;

            const rewardRate = await stakingContract.rewardRate();
            expect(rewardRate).to.be.gte(expectedRateMin);
            expect(rewardRate).to.be.lte(expectedRateMax);
        });
    });

    describe("roles and pause", function () {
        it("only pauser/guardian can pause; only pauser can unpause; paused blocks interactions", async function () {
            const { owner, user, other, stakingToken, stakingContract } = await loadFixture(deployFixture);

            // other cannot pause
            await expect(stakingContract.connect(other).pause()).to.be.revertedWith("not pauser/guardian");

            // grant guardian to other; can pause
            const GUARDIAN_ROLE = await stakingContract.GUARDIAN_ROLE();
            await stakingContract.connect(owner).grantRole(GUARDIAN_ROLE, await other.getAddress());
            await stakingContract.connect(other).pause();

            // paused blocks stake/withdraw/getReward
            const amount = ethers.parseEther("10");
            await (stakingToken as any).connect(user).approve(await stakingContract.getAddress(), amount);
            await expect(stakingContract.connect(user).stake(amount)).to.be.reverted;
            await expect(stakingContract.connect(user).withdraw(amount)).to.be.reverted;
            await expect(stakingContract.connect(user).getReward()).to.be.reverted;

            // guardian cannot unpause
            await expect(stakingContract.connect(other).unpause()).to.be.revertedWithCustomError(stakingContract, "AccessControlUnauthorizedAccount");

            // admin (pauser) can unpause
            await stakingContract.connect(owner).unpause();

            // now staking works
            await expect(stakingContract.connect(user).stake(amount))
                .to.emit(stakingContract, "Staked")
                .withArgs(await user.getAddress(), amount);
        });
    });

    describe("rescue and exit", function () {
        it("guardian can rescue non-staking tokens; cannot rescue staking token", async function () {
            const { owner, other, rewardToken, stakingToken, stakingContract } = await loadFixture(deployFixture);

            const GUARDIAN_ROLE = await stakingContract.GUARDIAN_ROLE();
            await stakingContract.connect(owner).grantRole(GUARDIAN_ROLE, await other.getAddress());

            // fund contract with rewards
            const rescueAmount = ethers.parseEther("123");
            await (rewardToken as any).mint(await stakingContract.getAddress(), rescueAmount);

            const before = await (rewardToken as any).balanceOf(await other.getAddress());
            await stakingContract.connect(other).rescueERC20(await rewardToken.getAddress(), rescueAmount);
            const after = await (rewardToken as any).balanceOf(await other.getAddress());
            expect(after - before).to.equal(rescueAmount);

            // cannot rescue staking token
            await expect(
                stakingContract.connect(other).rescueERC20(await stakingToken.getAddress(), 1n)
            ).to.be.revertedWith("no rescue staking token");
        });

        it("exit withdraws full stake and claims rewards", async function () {
            const { owner, user, stakingToken, rewardToken, stakingContract } = await loadFixture(deployFixture);
            const stakeAmount = ethers.parseEther("200");
            await (stakingToken as any).connect(user).approve(await stakingContract.getAddress(), stakeAmount);
            await stakingContract.connect(user).stake(stakeAmount);

            const notifyAmount = ethers.parseEther("1000");
            await (rewardToken as any).connect(owner).approve(await stakingContract.getAddress(), notifyAmount);
            await stakingContract.connect(owner).notifyRewardAmount(notifyAmount);
            await time.increase(100);

            const userRewardBefore = await (rewardToken as any).balanceOf(await user.getAddress());
            const userStakeBefore = await (stakingToken as any).balanceOf(await user.getAddress());

            await stakingContract.connect(user).exit();

            const userRewardAfter = await (rewardToken as any).balanceOf(await user.getAddress());
            const userStakeAfter = await (stakingToken as any).balanceOf(await user.getAddress());
            const internalBalance = await stakingContract.balances(await user.getAddress());

            expect(userStakeAfter - userStakeBefore).to.equal(stakeAmount);
            expect(userRewardAfter).to.be.greaterThan(userRewardBefore);
            expect(internalBalance).to.equal(0n);
        });
    });
});