import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

const { ethers } = hre;

describe("StakingReward", function () {
    async function deployFixture() {
        const [owner, user, other] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const stakingToken = await MockERC20.deploy("Staking Token", "STK", 0);
        await stakingToken.waitForDeployment();

        const rewardToken = await MockERC20.deploy("Reward Token", "RWD", 0);
        await rewardToken.waitForDeployment();

        const StakingReward = await ethers.getContractFactory("StakingReward");
        const stakingContract = await StakingReward.deploy(
            await rewardToken.getAddress(),
            await stakingToken.getAddress()
        );
        await stakingContract.waitForDeployment();

        const initialMint = ethers.parseEther("1000");
        await (stakingToken as any).mint(await user.getAddress(), initialMint);
        await (stakingToken as any).mint(await other.getAddress(), initialMint);

        return { owner, user, other, stakingToken, rewardToken, stakingContract, initialMint };
    }

    describe("constructor", function () {
        it("reverts when token addresses are zero", async function () {
            const { rewardToken, stakingToken, stakingContract } = await loadFixture(deployFixture);
            const StakingReward = await ethers.getContractFactory("StakingReward");

            await expect(
                StakingReward.deploy(ethers.ZeroAddress, await stakingToken.getAddress())
            ).to.be.revertedWithCustomError(stakingContract, "InvalidAddress");

            await expect(
                StakingReward.deploy(await rewardToken.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(stakingContract, "InvalidAddress");
        });
    });

    describe("views (initial state)", function () {
        it("has zero rewardPerToken and earned", async function () {
            const { user, stakingContract } = await loadFixture(deployFixture);
            expect(await stakingContract.rewardPertoken()).to.equal(0n);
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
            await expect(stakingContract.connect(user).stake(0n)).to.be.revertedWithCustomError(
                stakingContract,
                "NeedMoreThanZero"
            );
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
            await expect(stakingContract.connect(user).withdraw(0n)).to.be.revertedWithCustomError(
                stakingContract,
                "NeedMoreThanZero"
            );
        });

        it("reverts when withdrawing more than staked", async function () {
            const { user, stakingToken, stakingContract } = await loadFixture(deployFixture);
            const amount = ethers.parseEther("10");
            await (stakingToken as any).connect(user).approve(await stakingContract.getAddress(), amount);
            await stakingContract.connect(user).stake(amount);

            await expect(stakingContract.connect(user).withdraw(amount + 1n)).to.be.reverted; // underflow
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
});