// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStakingReward {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    // function getReward() external;
}
