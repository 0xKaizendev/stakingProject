// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "./interfaces/IStakingReward.sol";

/// @notice Contrat de staking minimaliste (ERC20 -> ERC20).
/// - CEI : toutes les fonctions externes qui transfèrent des fonds mettent à jour l'état AVANT l'interaction externe.
/// - nonReentrant : protège les fonctions critiques contre la réentrance.
contract StakingReward is AccessControlDefaultAdminRules, ReentrancyGuard, Pausable, IStakingReward {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardsToken;

    bytes32 public constant REWARDS_MANAGER_ROLE = keccak256("REWARDS_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint256 public rewardsDuration; // en secondes
    uint256 public rewardRate; // tokens par seconde
    uint256 public lastUpdateTime; // timestamp dernière màj des rewards
    uint256 public rewardPerTokenStored;
    uint256 public periodFinish; // timestamp fin d'émission

    uint256 public totalSupply;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 amount);
    event RewardsDurationUpdated(uint256 newDuration);

    constructor(address admin, IERC20 _staking, IERC20 _rewards, uint256 _rewardsDuration)
        AccessControlDefaultAdminRules(3 days, admin)
    {
        stakingToken = _staking;
        rewardsToken = _rewards;
        rewardsDuration = _rewardsDuration;

        _grantRole(REWARDS_MANAGER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    // ---------- lecture ----------
    function lastTimeRewardApplicable() public view returns (uint256) {
        uint256 finish = periodFinish;
        return block.timestamp < finish ? block.timestamp : finish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        uint256 timeDelta = lastTimeRewardApplicable() - lastUpdateTime;
        // 1e18 pour éviter les divisions entières
        return rewardPerTokenStored + (timeDelta * rewardRate * 1e18) / totalSupply;
    }

    function earned(address account) public view returns (uint256) {
        return (balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18 + rewards[account];
    }

    // ---------- modificateurs ----------
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ---------- interactions utilisateur ----------
    function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "amount=0");
        // CEI: Effects
        totalSupply += amount;
        balances[msg.sender] += amount;
        // CEI: Interactions
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public nonReentrant whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "amount=0");
        balances[msg.sender] -= amount;
        totalSupply -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public nonReentrant whenNotPaused updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        withdraw(balances[msg.sender]);
        getReward();
    }

    // ---------- gestion des récompenses ----------
    /// @dev Approche "pull": le manager envoie les tokens au contrat via safeTransferFrom,
    /// puis on (re)calcule le nouveau rate.
    function notifyRewardAmount(uint256 amount) external onlyRole(REWARDS_MANAGER_ROLE) updateReward(address(0)) {
        rewardsToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 timeRemaining = periodFinish > block.timestamp ? (periodFinish - block.timestamp) : 0;
        uint256 leftover = timeRemaining * rewardRate;

        uint256 newReward = amount + leftover;
        rewardRate = newReward / rewardsDuration;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;

        emit RewardAdded(amount);
    }

    function setRewardsDuration(uint256 newDuration) external onlyRole(DEFAULT_ADMIN_ROLE) updateReward(address(0)) {
        uint256 remaining = periodFinish > block.timestamp ? (periodFinish - block.timestamp) : 0;
        if (remaining > 0) {
            uint256 leftover = remaining * rewardRate;
            rewardRate = leftover / newDuration;
            periodFinish = block.timestamp + newDuration;
        }
        rewardsDuration = newDuration;
        emit RewardsDurationUpdated(newDuration);
    }

    // ---------- Guardian / Pause / Rescue ----------
    function pause() external {
        // Guardian ou Pauser
        if (!hasRole(PAUSER_ROLE, msg.sender) && !hasRole(GUARDIAN_ROLE, msg.sender)) {
            revert("not pauser/guardian");
        }
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Rescue de tokens accidentellement bloqués (sauf le stakingToken).
    function rescueERC20(address token, uint256 amount) external onlyRole(GUARDIAN_ROLE) {
        require(token != address(stakingToken), "no rescue staking token");
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
