import hre from "hardhat";

async function main() {
    const { ethers, network } = hre
    const [owner, user, other] = await ethers.getSigners();
    // const MockERC20 = await ethers.getContractFactory("MockERC20");
    // const stakingToken = await MockERC20.deploy("Staking Token", "STK", ethers.parseEther("10000"));
    // await stakingToken.waitForDeployment();
    // console.log("Staking token deployed at:", await stakingToken.getAddress())


    // const rewardToken = await MockERC20.deploy("Reward Token", "RWD", ethers.parseEther("10000"));
    // await rewardToken.waitForDeployment();
    // console.log("Reward token deployed at:", await rewardToken.getAddress())
    const rewardsDuration = 1000n; // seconds
    // const StakingReward = await ethers.getContractFactory("StakingReward");
    // const stakingContract = await StakingReward.deploy(
    //     await owner.getAddress(),
    //     await stakingToken.getAddress(),
    //     await rewardToken.getAddress(),
    //     rewardsDuration
    // );

    // console.log("Staking Contract deployed at:", await stakingContract.getAddress())
    const isLocal = ["hardhat", "local"].includes(network.name)

    const contracts = [
        {
            address: "0x8396637a8af04adea62C28D7541312107B7D11b8",
            constructorArguments: ["Staking Token", "STK", ethers.parseEther("10000")]
        },
        {
            address: "0x24cc2D287fD38186290c73813b2c78c87F6017d4",
            constructorArguments: ["Reward Token", "RWD", ethers.parseEther("10000")]
        },
        {
            address: "0xD3C509a418F9A3036A1Dd27Cbdd4EC6467C3bb2C",
            constructorArguments: [await owner.getAddress(),
                "0x8396637a8af04adea62C28D7541312107B7D11b8",
                "0x24cc2D287fD38186290c73813b2c78c87F6017d4",
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