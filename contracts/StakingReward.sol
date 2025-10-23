// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IStakingReward.sol";

//CEI: Check, Effect, Interact

contract StakingReward is IStakingReward {
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    uint256 public totalSupply;
    mapping(address => uint256) balances;
    mapping(address => uint256) userRewardPerTokenPaid;
    mapping(address => uint256) rewards;

    event Staked(address user, uint256 amount);
    event Withdrawn(address user, uint256 amount);

    //reward variables
    uint256 rewardRate;
    uint256 rewardDuration;
    uint256 rewardPertokenStored;
    uint256 periodFinish;
    uint256 lastUpdateTime;
    //error

    error NeedMoreThanZero();
    error InvalidAddress();

    //modifier

    modifier MoreThanZero(uint256 _amount) {
        if (_amount == 0) revert NeedMoreThanZero();
        _;
    }

    modifier updateReward(address _user) {
        rewardPertokenStored = rewardPertoken();
        rewards[msg.sender] = earned(_user);

        userRewardPerTokenPaid[_user] = rewardPertokenStored;
        _;
    }

    constructor(address _rewardToken, address _stakingToken) {
        if (_rewardToken == address(0) || _stakingToken == address(0)) revert InvalidAddress();

        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    function stake(uint256 _amount) external MoreThanZero(_amount) updateReward(msg.sender) {
        balances[msg.sender] += _amount;
        totalSupply += _amount;
        stakingToken.transferFrom(msg.sender, address(this), _amount);
        emit Staked(msg.sender, _amount);
    }

    function withdraw(uint256 _amount) external MoreThanZero(_amount) updateReward(msg.sender) {
        require(_amount > 0, "amount can not be zero");
        balances[msg.sender] -= _amount;
        totalSupply -= _amount;

        stakingToken.transfer(msg.sender, _amount);
        emit Withdrawn(msg.sender, _amount);
    }

    function rewardPertoken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPertokenStored;
        uint256 timeDelta = lastTimeRewardApplicable() - lastUpdateTime;

        return rewardPertokenStored + (timeDelta * rewardRate * 1e18) / totalSupply;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        uint256 finish = periodFinish;
        return block.timestamp < finish ? block.timestamp : finish;
    }

    function earned(address _user) public view returns (uint256) {
        return (balances[_user] * rewardPertoken() - userRewardPerTokenPaid[_user]) / 1e18 + rewards[_user];
    }
}
