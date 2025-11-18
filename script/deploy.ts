import hre from "hardhat";

async function main() {
    const { ethers, network } = hre
    const [owner,] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const stakingToken = await MockERC20.deploy("Staking Token", "STK", ethers.parseEther("10000"));
    await stakingToken.waitForDeployment();
    console.log("Staking token deployed at:", await stakingToken.getAddress())


    const rewardToken = await MockERC20.deploy("Reward Token", "RWD", ethers.parseEther("10000"));
    await rewardToken.waitForDeployment();
    console.log("Reward token deployed at:", await rewardToken.getAddress())
    const rewardsDuration = 1000n; // seconds
    const StakingReward = await ethers.getContractFactory("StakingReward");
    const stakingContract = await StakingReward.deploy(
        await owner.getAddress(),
        await stakingToken.getAddress(),
        await rewardToken.getAddress(),
        rewardsDuration
    );

    // console.log("Staking Contract deployed at:", await stakingContract.getAddress())
    const isLocal = ["hardhat", "local"].includes(network.name)

    const contracts = [
        {
            address: await stakingToken.getAddress(),
            constructorArguments: ["Staking Token", "STK", ethers.parseEther("10000")]
        },
        {
            address: await rewardToken.getAddress(),
            constructorArguments: ["Reward Token", "RWD", ethers.parseEther("10000")]
        },
        {
            address: await stakingContract.getAddress(),
            constructorArguments: [await owner.getAddress(),
            await stakingToken.getAddress(),
            await rewardToken.getAddress(),
                rewardsDuration]
        },
    ]

    console.log("Current NetWork:", network.name, "is Local:", isLocal)

    if (!isLocal) {
        // const receipt = await stakingContract.deploymentTransaction()?.wait(2)
        // console.log("Deployment confirmed in block", receipt?.blockNumber)
        contracts.map(async (c) => {
            await verify(c)
        })

    }

}

main().catch((error) => {
    console.log(error)
    process.exitCode = 1
})

async function verify(params: { address: string, constructorArguments: any[] }) {
    try {
        await hre.run("verify:verify", {
            ...params
        })

    } catch (error) {
        console.log("error verifying contract", params.address)
    }
}