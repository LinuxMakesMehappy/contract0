import React, { useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { RewardDistributionInterface } from './reward-interface';

interface StakingInterfaceProps {
  connection: Connection;
  marketAddress: string;
  userAccountAddress: string;
  permanentAccountAddress: string;
}

// Predefined duration options
const DURATION_OPTIONS = [
  { days: 1, label: '1 Day', color: 'bg-gray-100 text-gray-700' },
  { days: 7, label: '7 Days', color: 'bg-blue-100 text-blue-700' },
  { days: 14, label: '14 Days', color: 'bg-green-100 text-green-700' },
  { days: 30, label: '30 Days', color: 'bg-yellow-100 text-yellow-700' },
  { days: 60, label: '60 Days', color: 'bg-purple-100 text-purple-700' },
  { days: 90, label: '90 Days', color: 'bg-red-100 text-red-700' },
  { days: 180, label: '180 Days', color: 'bg-indigo-100 text-indigo-700' },
  { days: 365, label: '1 Year', color: 'bg-pink-100 text-pink-700' },
];

export const StakingInterface: React.FC<StakingInterfaceProps> = ({
  connection,
  marketAddress,
  userAccountAddress,
  permanentAccountAddress,
}) => {
  const wallet = useWallet();
  const [rewardInterface, setRewardInterface] = useState<RewardDistributionInterface | null>(null);
  const [userAccount, setUserAccount] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Staking form state
  const [stakeAmount, setStakeAmount] = useState<number>(1);
  const [selectedDuration, setSelectedDuration] = useState<number>(1); // Default to 1 day
  const [customDuration, setCustomDuration] = useState<number>(1);
  const [useCustomDuration, setUseCustomDuration] = useState<boolean>(false);
  const [enableMultiply, setEnableMultiply] = useState<boolean>(false);
  const [immediateLiquidity, setImmediateLiquidity] = useState<boolean>(true);

  // Withdrawal state
  const [showWithdrawal, setShowWithdrawal] = useState<boolean>(false);
  const [earlyExitPenalty, setEarlyExitPenalty] = useState<number>(0);
  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(0);

  useEffect(() => {
    if (wallet.connected && wallet.publicKey) {
      const interface_ = new RewardDistributionInterface(connection, wallet);
      setRewardInterface(interface_);
      loadUserData();
    }
  }, [wallet.connected, wallet.publicKey, connection]);

  const loadUserData = async () => {
    if (!rewardInterface) return;
    
    try {
      setLoading(true);
      const userAccountPubkey = new PublicKey(userAccountAddress);
      const account = await rewardInterface.getUserAccount(userAccountPubkey);
      setUserAccount(account);
      
      // Calculate early exit penalty if user has active stake
      if (account.stakeAmount > 0) {
        calculateEarlyExitPenalty(account);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      setMessage('Error loading user data');
    } finally {
      setLoading(false);
    }
  };

  const calculateEarlyExitPenalty = (account: any) => {
    const currentTime = Math.floor(Date.now() / 1000);
    const isEarlyExit = currentTime < account.intendedEndTime.toNumber();
    
    if (isEarlyExit) {
      const timeElapsed = currentTime - account.stakeStartTime.toNumber();
      const totalDuration = account.intendedEndTime.toNumber() - account.stakeStartTime.toNumber();
      const progressPercentage = (timeElapsed / totalDuration) * 100;
      
      // Calculate realized rewards (simplified)
      const baseRewardRate = 1700; // 17% APY in basis points
      const tierMultiplier = getTierMultiplier(account.tier);
      
      const realizedRewards = account.stakeAmount
        .mul(new (require('@coral-xyz/anchor').web3.BN)(baseRewardRate))
        .mul(new (require('@coral-xyz/anchor').web3.BN)(timeElapsed))
        .mul(new (require('@coral-xyz/anchor').web3.BN)(tierMultiplier))
        .div(new (require('@coral-xyz/anchor').web3.BN)(365 * 24 * 60 * 60 * 10000));
      
      // Calculate Kamino multiply yields (if enabled)
      const kaminoYields = account.kaminoMultiplyPosition ? realizedRewards.mul(new (require('@coral-xyz/anchor').web3.BN)(3)) : new (require('@coral-xyz/anchor').web3.BN)(0);
      
      // Total yield + staking rewards = staking rewards + Kamino yields
      const totalYieldAndRewards = realizedRewards.add(kaminoYields);
      
      const penalty = totalYieldAndRewards.toNumber() / 1e9; // Convert to SOL
      setEarlyExitPenalty(penalty);
      
      // User gets: Initial capital - (yield + staking rewards)
      const initialCapital = account.stakeAmount.toNumber() / 1e9;
      const withdrawalAmount = Math.max(0, initialCapital - penalty); // Never negative
      setWithdrawalAmount(withdrawalAmount);
    } else {
      setEarlyExitPenalty(0);
      setWithdrawalAmount(account.stakeAmount.toNumber() / 1e9);
    }
  };

  const getTierMultiplier = (tier: string): number => {
    switch (tier) {
      case 'Diamond': return 150;
      case 'Gold': return 125;
      case 'Silver': return 100;
      case 'Bronze': return 75;
      default: return 100;
    }
  };

  const handleStake = async () => {
    if (!rewardInterface || !wallet.publicKey) return;

    try {
      setLoading(true);
      setMessage('');

      const duration = useCustomDuration ? customDuration : selectedDuration;
      const marketPubkey = new PublicKey(marketAddress);
      const userAccountPubkey = new PublicKey(userAccountAddress);
      
      if (immediateLiquidity) {
        const tx = await rewardInterface.stakeWithImmediateLiquidity(
          marketPubkey,
          userAccountPubkey,
          stakeAmount,
          duration,
          enableMultiply
        );
        setMessage(`Stake with immediate liquidity successful! Transaction: ${tx}`);
      } else {
        // Fallback to regular staking (if needed)
        const tx = await rewardInterface.stakeWithDuration(
          marketPubkey,
          userAccountPubkey,
          stakeAmount,
          duration
        );
        setMessage(`Stake successful! Transaction: ${tx}`);
      }
      
      await loadUserData(); // Reload data
    } catch (error) {
      console.error('Error staking:', error);
      setMessage('Error staking');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!rewardInterface || !wallet.publicKey) return;

    try {
      setLoading(true);
      setMessage('');

      const marketPubkey = new PublicKey(marketAddress);
      const userAccountPubkey = new PublicKey(userAccountAddress);
      const permanentAccountPubkey = new PublicKey(permanentAccountAddress);
      
      const tx = await rewardInterface.withdrawWithImmediateLiquidity(
        marketPubkey,
        userAccountPubkey,
        permanentAccountPubkey
      );
      
      setMessage(`Withdrawal with immediate liquidity successful! Transaction: ${tx}`);
      await loadUserData(); // Reload data
    } catch (error) {
      console.error('Error withdrawing:', error);
      setMessage('Error withdrawing');
    } finally {
      setLoading(false);
    }
  };

  const getDurationColor = (days: number) => {
    const option = DURATION_OPTIONS.find(opt => opt.days === days);
    return option ? option.color : 'bg-gray-100 text-gray-700';
  };

  if (!wallet.connected) {
    return <div className="p-4">Please connect your wallet to continue.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold text-center mb-8">
        Flexible Staking Interface
      </h1>

      {/* Current Status */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Current Status</h2>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600">Stake Amount</p>
              <p className="text-lg font-semibold">
                {userAccount ? `${(userAccount.stakeAmount.toNumber() / 1e9).toFixed(4)} SOL` : '0 SOL'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Lock Duration</p>
              <p className="text-lg font-semibold">
                {userAccount && userAccount.lockDurationDays ? `${userAccount.lockDurationDays} days` : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">End Date</p>
              <p className="text-lg font-semibold">
                {userAccount && userAccount.intendedEndTime ? 
                  new Date(userAccount.intendedEndTime.toNumber() * 1000).toLocaleDateString() : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">User Tier</p>
              <p className="text-lg font-semibold">
                {userAccount ? userAccount.tier : 'N/A'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Staking Form */}
      {(!userAccount || userAccount.stakeAmount.toNumber() === 0) && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Stake SOL</h2>
          
          <div className="space-y-4">
            {/* Amount Input */}
            <div>
              <label className="block text-sm font-medium mb-2">Stake Amount (SOL)</label>
              <input
                type="number"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(Number(e.target.value))}
                className="w-full p-2 border rounded-md"
                step="0.1"
                min="0.1"
              />
            </div>

            {/* Immediate Liquidity Options */}
            <div className="space-y-4">
              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={immediateLiquidity}
                    onChange={(e) => setImmediateLiquidity(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">Enable Immediate Liquidity (JupSOL + Kamino)</span>
                </label>
                <p className="text-xs text-gray-600 mt-1">
                  Convert to JupSOL for instant unstaking with no fees or delays
                </p>
              </div>

              {immediateLiquidity && (
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={enableMultiply}
                      onChange={(e) => setEnableMultiply(e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm font-medium">Enable Kamino Multiply (Max Leverage)</span>
                  </label>
                  <p className="text-xs text-gray-600 mt-1">
                    Use Kamino multiply for maximum yield amplification
                  </p>
                </div>
              )}
            </div>

            {/* Duration Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">Lock Duration</label>
              
              {/* Predefined Duration Buttons */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {DURATION_OPTIONS.map((option) => (
                  <button
                    key={option.days}
                    onClick={() => {
                      setSelectedDuration(option.days);
                      setUseCustomDuration(false);
                    }}
                    disabled={useCustomDuration}
                    className={`p-3 rounded-md border-2 transition-colors ${
                      !useCustomDuration && selectedDuration === option.days
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    } ${option.color}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {/* Custom Duration */}
              <div className="flex items-center space-x-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={useCustomDuration}
                    onChange={(e) => setUseCustomDuration(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">Custom Duration</span>
                </label>
                
                {useCustomDuration && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={customDuration}
                      onChange={(e) => setCustomDuration(Number(e.target.value))}
                      className="w-20 p-2 border rounded-md"
                      min="1"
                      max="3650" // 10 years max
                    />
                    <span className="text-sm text-gray-600">days</span>
                  </div>
                )}
              </div>
            </div>

            {/* APY Display */}
            <div className="bg-blue-50 p-4 rounded-md">
              <h3 className="font-semibold text-blue-800 mb-2">Expected APY</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Base APY:</span>
                  <span className="ml-2 font-semibold">17%</span>
                </div>
                <div>
                  <span className="text-gray-600">Tier Bonus:</span>
                  <span className="ml-2 font-semibold">
                    {userAccount ? `${getTierMultiplier(userAccount.tier) - 100}%` : '0%'}
                  </span>
                </div>

                {enableMultiply && (
                  <div>
                    <span className="text-gray-600">Kamino Multiply:</span>
                    <span className="ml-2 font-semibold text-purple-600">+300%</span>
                  </div>
                )}
                <div>
                  <span className="text-gray-600">Total APY:</span>
                  <span className="ml-2 font-semibold text-green-600">
                    {userAccount ? 
                      `${(17 * (getTierMultiplier(userAccount.tier) / 100) * (enableMultiply ? 4 : 1)).toFixed(1)}%` : 
                      '17%'}
                  </span>
                </div>
              </div>
            </div>

            {/* Early Exit Warning */}
            {immediateLiquidity && (
              <div className="bg-yellow-50 p-4 rounded-md">
                <h3 className="font-semibold text-yellow-800 mb-2">⚠️ Early Exit Penalty</h3>
                <p className="text-sm text-yellow-700">
                  Withdrawing before your committed duration will result in a deduction of 
                  <strong> yield + staking rewards</strong> from your initial capital.
                </p>
                <p className="text-sm text-yellow-700 mt-2">
                  <strong>Immediate Liquidity:</strong> You can withdraw anytime, but early exit penalties apply.
                </p>
              </div>
            )}

            {/* Stake Button */}
            <button
              onClick={handleStake}
              disabled={loading || stakeAmount <= 0}
              className="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 disabled:opacity-50 font-semibold"
            >
              {loading ? 'Staking...' : `Stake ${stakeAmount} SOL for ${useCustomDuration ? customDuration : selectedDuration} days`}
            </button>
          </div>
        </div>
      )}

      {/* Withdrawal Section */}
      {userAccount && userAccount.stakeAmount.toNumber() > 0 && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Withdraw Stake</h2>
          
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Current Stake</p>
                <p className="text-lg font-semibold">
                  {(userAccount.stakeAmount.toNumber() / 1e9).toFixed(4)} SOL
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Early Exit Penalty</p>
                <p className="text-lg font-semibold text-red-600">
                  {earlyExitPenalty.toFixed(4)} SOL
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Withdrawal Amount</p>
                <p className="text-lg font-semibold text-green-600">
                  {withdrawalAmount.toFixed(4)} SOL
                </p>
              </div>
            </div>

            {earlyExitPenalty > 0 && (
              <div className="bg-yellow-50 p-4 rounded-md">
                <p className="text-yellow-800 text-sm">
                  ⚠️ Early exit penalty applies. You will receive {withdrawalAmount.toFixed(4)} SOL (yield + staking rewards deducted from initial capital).
                </p>
              </div>
            )}

            <button
              onClick={handleWithdraw}
              disabled={loading}
              className="w-full bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700 disabled:opacity-50 font-semibold"
            >
              {loading ? 'Withdrawing...' : `Withdraw ${withdrawalAmount.toFixed(4)} SOL`}
            </button>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`p-4 rounded-md ${
          message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}>
          {message}
        </div>
      )}
    </div>
  );
};
